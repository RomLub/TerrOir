import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createStockAlert } from "@/lib/stock-alerts/create-alert";
import { sendTemplate } from "@/lib/resend/send";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";
import { maskEmail } from "@/lib/rgpd/mask-email";
import StockAlertConfirm, {
  subject as confirmSubject,
} from "@/lib/resend/templates/stock-alert-confirm";

// POST /api/stock-alerts — création d'une alerte stock dispo (anon ou
// authentifié). Premier endpoint POST anonyme du repo : RLS bypass via
// service-role applicatif (cf. arbitrage D PUSH 1, table en service-role
// only). La sécurité repose sur :
//   - validation Zod stricte (consent obligatoire)
//   - validation business (produit doit être active + indispo)
//   - rate limit applicatif par email (10/h, count via SELECT)
//   - double opt-in côté email (PUSH 4 reste : confirm route)

const bodySchema = z.object({
  product_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  // Consentement RGPD explicite : checkbox cochée. literal(true) = false
  // ou absent → 400. Pas d'opt-in implicite.
  consent: z.literal(true),
});

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 heure
const RATE_LIMIT_MAX = 10;

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { product_id, email } = parsed.data;
  const session = await getSessionUser();
  const consumerId = session?.id ?? null;

  const admin = createSupabaseAdminClient();

  // 1. Validation business : produit existe + active + indispo (stock=0
  // AND !stock_illimite). Cf. arbitrage A PUSH 1 (sémantique indispo).
  const { data: productData, error: productError } = await admin
    .from("products")
    .select("id, active, stock_disponible, stock_illimite, nom, producer_id")
    .eq("id", product_id)
    .maybeSingle();

  if (productError) {
    console.error(
      `STOCK_ALERT_CREATE_PRODUCT_FETCH_ERROR product_id=${product_id} error=${productError.message}`,
    );
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!productData) {
    return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
  }

  const product = productData as {
    id: string;
    active: boolean | null;
    stock_disponible: number | null;
    stock_illimite: boolean | null;
    nom: string;
    producer_id: string | null;
  };

  if (product.active !== true) {
    return NextResponse.json(
      { error: "Ce produit n'est pas disponible à la vente" },
      { status: 400 },
    );
  }
  if (
    product.stock_illimite === true ||
    (product.stock_disponible ?? 0) > 0
  ) {
    return NextResponse.json(
      { error: "Ce produit est en stock — alerte inutile" },
      { status: 400 },
    );
  }

  // 2. Rate limit par email : count des rows créées dans la dernière heure.
  // Best-effort : si le count plante, on continue plutôt que de bloquer un
  // user légitime — la double opt-in protège du spam de masse.
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MS,
  ).toISOString();
  const { data: recentAlerts, error: countError } = await admin
    .from("product_stock_alerts")
    .select("id")
    .ilike("email", email)
    .gte("created_at", windowStart);

  if (countError) {
    console.error(
      `STOCK_ALERT_CREATE_RATE_FETCH_ERROR email=${maskEmail(email)} error=${countError.message}`,
    );
  } else if ((recentAlerts?.length ?? 0) >= RATE_LIMIT_MAX) {
    console.warn(
      `STOCK_ALERT_RATE_LIMIT email=${maskEmail(email)} count=${recentAlerts?.length}`,
    );
    return NextResponse.json(
      { error: "Trop de demandes récentes pour cette adresse" },
      { status: 429 },
    );
  }

  // 3. Création / résurrection
  const result = await createStockAlert(admin, {
    product_id,
    email,
    consumer_id: consumerId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // 4. No-op silencieux (alerte déjà active)
  if (result.data.already_active) {
    return NextResponse.json({ status: "already_active" });
  }

  // 5. Envoi email confirm (double opt-in)
  const confirmToken = result.data.confirm_token;
  const unsubscribeToken = result.data.unsubscribe_token;
  if (!confirmToken || !unsubscribeToken) {
    // Sécurité : already_active=false implique tokens présents (helper
    // PUSH 2). Si null, c'est un bug du helper, on log et on retourne ok
    // sans email pour ne pas casser l'UX, le user ré-essayera.
    console.error(
      `STOCK_ALERT_CREATE_TOKENS_MISSING product_id=${product_id} email=${maskEmail(email)}`,
    );
    return NextResponse.json({ status: "created" });
  }

  // Récupère le slug producer pour construire l'URL produit. Best-effort.
  let producerSlug: string | null = null;
  if (product.producer_id) {
    const { data: producerData } = await admin
      .from("producers")
      .select("slug")
      .eq("id", product.producer_id)
      .maybeSingle();
    producerSlug = (producerData as { slug: string | null } | null)?.slug ?? null;
  }
  const productUrl = producerSlug
    ? `${NEXT_PUBLIC_APP_URL}/producteurs/${producerSlug}/produits/${product.id}`
    : `${NEXT_PUBLIC_APP_URL}/producteurs`;
  const confirmUrl = `${NEXT_PUBLIC_APP_URL}/api/stock-alerts/confirm?token=${confirmToken}`;
  const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/api/stock-alerts/unsubscribe?token=${unsubscribeToken}`;

  const props = {
    productName: product.nom,
    productUrl,
    confirmUrl,
    unsubscribeUrl,
  };

  const sendResult = await sendTemplate({
    to: email,
    userId: consumerId,
    template: "stock-alert-confirm",
    subject: confirmSubject(props),
    element: <StockAlertConfirm {...props} />,
    metadata: { product_id, alert_id: result.data.id },
  });

  if (!sendResult.ok) {
    console.error(
      `STOCK_ALERT_CREATE_SEND_ERROR alert_id=${result.data.id} error=${sendResult.error}`,
    );
    // L'alerte est créée en DB mais pas confirmable sans email. Le user
    // peut re-tenter (résurrection regénèrera tokens). On retourne 200
    // tout en logguant l'erreur — pas la peine de stresser le user.
  }

  // Distinction created/resurrected non remontée : le helper PUSH 2 ne la
  // tracke pas (already_active suffit pour la branche no-op). Côté UX, le
  // user voit toujours "Vérifiez votre email pour confirmer" — pas de
  // valeur ajoutée à différencier création initiale vs résurrection.
  return NextResponse.json({ status: "created" });
}

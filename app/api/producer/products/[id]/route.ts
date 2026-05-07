import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyBackInStock } from "@/lib/stock-alerts/notify-back-in-stock";

// PATCH /api/producer/products/[id]
//
// Premier endpoint applicatif côté producer pour mettre à jour le
// stock + activation produit (jusqu'ici, /catalogue mutait via Supabase
// JS browser-side direct, RLS-validé par "products owner all"). Cette
// route applicative existe pour permettre le HOOK SYNCHRONE NOTIFY :
// quand un producer rebascule un produit indispo en dispo
// (stock_disponible = 0 → > 0, ou stock_illimite false → true), on
// déclenche notifyBackInStock pour envoyer les emails aux alertes
// éligibles. Pas faisable propre côté browser (pas d'accès Resend).
//
// Champs éditables : stock_disponible (>= 0), stock_illimite (bool),
// active (bool). Au moins un requis. Body Zod refine non-empty.
//
// Auth + ownership :
//   1. session ou 401
//   2. SELECT producers WHERE user_id = session.id → 403 si pas
//      producer (user a pas de profil producer)
//   3. SELECT products WHERE id = params.id → 404 si pas trouvé
//   4. product.producer_id === producer.id → 403 si pas owner
//
// Hook notify post-UPDATE :
//   - Calcul wasIndispo AVANT UPDATE (stock_illimite!=true && stock_disponible=0)
//   - Calcul isDispoNow APRÈS UPDATE (en mergant body avec état pré-UPDATE)
//   - Si wasIndispo && isDispoNow → notifyBackInStock(admin, productId)
//   - Erreur notify ne fait pas échouer la PATCH (best-effort, log + continue)

const bodySchema = z
  .object({
    stock_disponible: z.number().int().min(0).optional(),
    stock_illimite: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.stock_disponible !== undefined ||
      data.stock_illimite !== undefined ||
      data.active !== undefined,
    { message: "At least one field must be provided" },
  );

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!z.string().uuid().safeParse(params.id).success) {
    return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // 1. Lookup producer pour la session courante
  const { data: producerData, error: producerError } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", session.id)
    .maybeSingle();

  if (producerError) {
    console.error(
      `PRODUCER_PRODUCT_UPDATE_PRODUCER_FETCH_ERROR user_id=${session.id} error=${producerError.message}`,
    );
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!producerData) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const producerId = (producerData as { id: string }).id;

  // 2. Lookup product + ownership check
  const { data: productData, error: productError } = await admin
    .from("products")
    .select("id, producer_id, stock_disponible, stock_illimite")
    .eq("id", params.id)
    .maybeSingle();

  if (productError) {
    console.error(
      `PRODUCER_PRODUCT_UPDATE_PRODUCT_FETCH_ERROR product_id=${params.id} error=${productError.message}`,
    );
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
  if (!productData) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const product = productData as {
    id: string;
    producer_id: string | null;
    stock_disponible: number | null;
    stock_illimite: boolean | null;
  };

  if (product.producer_id !== producerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. État indispo AVANT UPDATE pour décider du hook notify
  const wasIndispo =
    product.stock_illimite !== true && (product.stock_disponible ?? 0) === 0;

  // 4. UPDATE
  const { error: updateError } = await admin
    .from("products")
    .update(parsed.data)
    .eq("id", params.id);

  if (updateError) {
    console.error(
      `PRODUCER_PRODUCT_UPDATE_ERROR product_id=${params.id} error=${updateError.message}`,
    );
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // 5. État dispo APRÈS UPDATE (merge body sur état pré-UPDATE pour
  // calculer la valeur effective des 2 champs, sans re-SELECT).
  const newStockIllimite =
    parsed.data.stock_illimite ?? product.stock_illimite ?? false;
  const newStockDisponible =
    parsed.data.stock_disponible ?? product.stock_disponible ?? 0;
  const isDispoNow = newStockIllimite === true || newStockDisponible > 0;

  // 6. Hook synchrone notify si transition indispo → dispo. Best-effort :
  // erreur notify ne fait pas échouer la PATCH (le producer voit son
  // UPDATE OK, on log côté serveur et le worker manuel pourra retry).
  if (wasIndispo && isDispoNow) {
    try {
      const result = await notifyBackInStock(admin, params.id);
      console.log(
        `PRODUCER_PRODUCT_UPDATE_NOTIFY_DONE product_id=${params.id} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`,
      );
    } catch (e) {
      const err = e as Error;
      console.error(
        `PRODUCER_PRODUCT_UPDATE_NOTIFY_ERROR product_id=${params.id} error=${err.message}`,
      );
    }
  }

  return NextResponse.json({
    id: params.id,
    stock_disponible: newStockDisponible,
    stock_illimite: newStockIllimite,
    active: parsed.data.active ?? null,
  });
}

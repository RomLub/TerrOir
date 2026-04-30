import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { extractHeureRetrait } from "@/lib/slots/format-slot-time";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";

const bodySchema = z.object({
  producer_id: z.string().uuid(),
  slot_id: z.string().uuid(),
  date_retrait: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes_client: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantite: z.number().positive(),
      }),
    )
    .min(1),
});

// Mappe les SQLSTATE levés par create_order_with_items vers HTTP.
function sqlstateToStatus(code: string | undefined): number {
  switch (code) {
    case "22023":
      return 400;
    case "P0002":
      return 404;
    case "23514":
      return 409;
    case "42501":
      return 403;
    default:
      return 500;
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { producer_id, slot_id, date_retrait, notes_client, items } =
    parsed.data;

  // User client : auth.uid() est posé, indispensable pour la RPC
  // SECURITY DEFINER qui vérifie p_consumer_id = auth.uid().
  const supabase = createSupabaseServerClient();

  // heure_retrait = heure locale (Europe/Paris) extraite du slot.starts_at,
  // autoritatif côté serveur. La RPC attend un `time` ; on passe "HH:MM:00".
  const { data: slot } = await supabase
    .from("slots")
    .select("starts_at")
    .eq("id", slot_id)
    .maybeSingle();
  if (!slot) {
    return NextResponse.json(
      { error: "Créneau invalide ou indisponible" },
      { status: 409 },
    );
  }

  // T-428 idempotence : si une order pending existe déjà pour
  // {consumer_id, slot_id, date_retrait} dans les 5 dernières minutes,
  // on la renvoie directement (dedup race condition refresh / multi-tab /
  // back-forward post-init partielle). Pattern aligné T-405 (anti-race
  // requery DB) + T-407 (state guards UX). Pas de duplication audit log :
  // la 1ère création a déjà loggé via T-429.
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const dedupCutoff = new Date(Date.now() - FIVE_MIN_MS).toISOString();
  const { data: existingOrder } = await supabase
    .from("orders")
    .select(
      "id, code_commande, montant_total, commission_terroir, montant_net_producteur",
    )
    .eq("consumer_id", session.id)
    .eq("slot_id", slot_id)
    .eq("date_retrait", date_retrait)
    .eq("statut", "pending")
    .gt("created_at", dedupCutoff)
    .limit(1)
    .maybeSingle();
  if (existingOrder) {
    return NextResponse.json({
      order_id: existingOrder.id,
      code_commande: existingOrder.code_commande,
      montant_total: existingOrder.montant_total,
      commission: existingOrder.commission_terroir,
      montant_net: existingOrder.montant_net_producteur,
    });
  }

  const { data: orderId, error: rpcError } = await supabase.rpc(
    "create_order_with_items",
    {
      p_consumer_id: session.id,
      p_producer_id: producer_id,
      p_slot_id: slot_id,
      p_date_retrait: date_retrait,
      p_heure_retrait: extractHeureRetrait(slot.starts_at as string),
      p_notes_client: notes_client ?? null,
      // prix_unitaire est présent pour cohérence d'interface mais la RPC
      // l'ignore et refacture au prix DB courant.
      p_items: items.map((i) => ({
        product_id: i.product_id,
        quantite: i.quantite,
        prix_unitaire: 0,
      })),
    },
  );

  if (rpcError) {
    return NextResponse.json(
      { error: rpcError.message, code: rpcError.code },
      { status: sqlstateToStatus(rpcError.code) },
    );
  }
  if (!orderId) {
    return NextResponse.json(
      { error: "RPC returned no order_id" },
      { status: 500 },
    );
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      "code_commande, montant_total, commission_terroir, montant_net_producteur",
    )
    .eq("id", orderId as string)
    .single();

  // T-429 audit forensique pré-Live (RGPD compliance + reporting). Pose
  // un audit_log post-RPC réussie, avant retour HTTP au client. Pattern
  // await direct (helper fail-safe interne via try/catch swallow, idem
  // 8+ call sites refund/cancel/webhook/cron). Fallback ?? null si SELECT
  // post-RPC échoue silencieusement (T-427 documenté).
  await logPaymentEvent({
    eventType: "order_created",
    userId: session.id,
    metadata: {
      order_id: orderId,
      producer_id,
      slot_id,
      date_retrait,
      montant_total: order?.montant_total ?? null,
      commission: order?.commission_terroir ?? null,
      montant_net: order?.montant_net_producteur ?? null,
      items_count: items.length,
    },
  });

  return NextResponse.json({
    order_id: orderId,
    code_commande: order?.code_commande,
    montant_total: order?.montant_total,
    commission: order?.commission_terroir,
    montant_net: order?.montant_net_producteur,
  });
}

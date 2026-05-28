import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { userOwnsProducer } from "@/lib/auth/producerOwnership";
import { sqlstateToStatus } from "@/lib/api/sqlstate-to-status";
import { type OrderStatus } from "@/lib/orders/stateMachine";
import {
  BADGE_WINDOW_MONTHS,
  CONFIRMATION_THRESHOLD_MS,
} from "@/lib/producers/scoring-constants";
import { googleMapsUrl, sendTemplate } from "@/lib/resend/send";
import OrderConfirmedConsumer, {
  subject as confirmedSubject,
  type OrderItemLine,
} from "@/lib/resend/templates/order-confirmed-consumer";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, props0: RouteContext) {
  const params = await props0.params;
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, producer_id, consumer_id, statut, code_commande, created_at, date_retrait, heure_retrait, montant_total",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!(await userOwnsProducer(admin, session.id, order.producer_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (order.statut === "confirmed") {
    return NextResponse.json({ ok: true, already: true });
  }

  // F-001 P0-TA : transition pending → confirmed via RPC SECDEF dédiée
  // (auth dispatch interne owner > admin > service_role + assertTransition
  // SQL-side miroir state machine + UPDATE atomique + audit log
  // `order_confirmed` cluster, le tout dans la même transaction).
  // userOwnsProducer côté route reste pour shortcircuit applicatif (économise
  // 1 RTT avant l'appel RPC sur un caller non-owner) et lecture order pour
  // email + badge (la RPC retourne juste l'uuid).
  const confirmedAt = new Date();
  const { error: rpcError } = await admin.rpc("confirm_order_by_producer", {
    p_order_id: order.id,
  });
  if (rpcError) {
    const status = sqlstateToStatus(rpcError.code);
    if (status === 500) {
      console.error(
        `[CONFIRM_RPC_ERR] order=${order.id} code=${rpcError.code ?? "none"} message=${rpcError.message}`,
      );
      return NextResponse.json(
        { error: "Internal database error" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: rpcError.message, code: rpcError.code ?? undefined },
      { status },
    );
  }

  // Invalide le cache des stats publiques (ordersCount sur la home) :
  // l'order vient d'entrer dans le filtre IN ('confirmed','completed').
  // Try/catch défensif — un échec d'invalidation ne doit pas 500 la confirmation.
  try {
    revalidateTag("public-stats", "max");
  } catch (e) {
    console.warn(`[STATS_REVAL_WARN] order=${order.id} ${(e as Error).message}`);
  }

  // 1. Recalcul badge_confirmation_score du producteur (% confirmées
  //    ≤ CONFIRMATION_THRESHOLD sur la fenêtre BADGE_WINDOW_MONTHS).
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - BADGE_WINDOW_MONTHS);
  const { data: history } = await admin
    .from("orders")
    .select("created_at, confirmed_at")
    .eq("producer_id", order.producer_id)
    .not("confirmed_at", "is", null)
    .gte("created_at", cutoff.toISOString());

  if (history && history.length > 0) {
    const fast = history.filter((o) => {
      if (!o.confirmed_at || !o.created_at) return false;
      const deltaMs =
        new Date(o.confirmed_at).getTime() - new Date(o.created_at).getTime();
      return deltaMs <= CONFIRMATION_THRESHOLD_MS;
    }).length;
    const score = Math.round((fast / history.length) * 10000) / 100;
    // bugs-P2-6 (T9 2026-05-07) : destructure error pour rendre visible un
    // badge stale silencieux (RLS bug, statement_timeout, etc.). Le UPDATE
    // reste fail-safe (pas de 500) car le badge est un cache non-critique
    // recalculé hebdomadairement par le cron weekly-badges.
    const { error: badgeUpdateErr } = await admin
      .from("producers")
      .update({ badge_confirmation_score: score })
      .eq("id", order.producer_id);
    if (badgeUpdateErr) {
      console.error(
        `[BADGE_UPDATE_ERR] producer=${order.producer_id} badge=confirmation error=${badgeUpdateErr.message}`,
      );
    }
  }

  // 2. Email récap au consommateur
  const [{ data: consumer }, { data: producer }, { data: lines }] =
    await Promise.all([
      admin
        .from("users")
        .select("email")
        .eq("id", order.consumer_id)
        .maybeSingle(),
      admin
        .from("producers")
        .select("nom_exploitation, adresse, commune, code_postal")
        .eq("id", order.producer_id)
        .maybeSingle(),
      admin
        .from("order_items")
        .select("quantite, prix_unitaire, sous_total, products(nom, unite)")
        .eq("order_id", order.id),
    ]);

  if (consumer?.email && producer) {
    const adresse = [producer.adresse, producer.code_postal, producer.commune]
      .filter(Boolean)
      .join(", ");
    const items: OrderItemLine[] = (lines ?? []).map(
      (l: {
        quantite: number;
        sous_total: number;
        products: { nom: string; unite: string } | { nom: string; unite: string }[] | null;
      }) => {
        const product = Array.isArray(l.products) ? l.products[0] : l.products;
        return {
          nom: product?.nom ?? "",
          quantite: Number(l.quantite),
          unite: product?.unite ?? "",
          sousTotal: Number(l.sous_total),
        };
      },
    );

    const props = {
      codeCommande: order.code_commande,
      exploitation: producer.nom_exploitation,
      dateRetrait: order.date_retrait ?? "",
      heureRetrait: (order.heure_retrait ?? "").slice(0, 5),
      adresse,
      mapsUrl: googleMapsUrl(adresse || producer.nom_exploitation),
      items,
      total: Number(order.montant_total),
    };

    await sendTemplate({
      to: consumer.email,
      userId: order.consumer_id,
      template: "order_confirmed_consumer",
      subject: confirmedSubject(props),
      element: <OrderConfirmedConsumer {...props} />,
      metadata: { order_id: order.id, code_commande: order.code_commande },
    });
  }

  return NextResponse.json({ ok: true, confirmed_at: confirmedAt.toISOString() });
}

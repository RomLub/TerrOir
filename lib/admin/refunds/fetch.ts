import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Chantier 5 — helpers service_role pour la surface « Remboursements »
// (fusion des deux vues : demandes à arbitrer = pending_refunds, incidents
// techniques = refund_incidents). Extraction de la query inline de
// app/(admin)/refunds/pending/page.tsx pour testabilité + factorisation.
//
// Pattern aligné lib/admin/producers/fetch.ts : client injecté, mapping
// raw→row interne, fail-safe { rows, error } (pas de throw).

export type AdminPendingRefundRow = {
  id: string;
  order_id: string;
  producer_id: string;
  amount_eur: number;
  reason: string | null;
  status: "pending" | "approved" | "denied" | "expired";
  requested_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  order_code: string | null;
  producer_name: string | null;
};

export type FetchAdminPendingRefundsResult = {
  rows: AdminPendingRefundRow[];
  error: string | null;
};

type RawPendingRefund = {
  id: string;
  order_id: string;
  producer_id: string;
  amount_eur: number | string;
  reason: string | null;
  status: AdminPendingRefundRow["status"];
  requested_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  order: { code_commande: string | null } | Array<{ code_commande: string | null }> | null;
  producer:
    | { nom_exploitation: string | null }
    | Array<{ nom_exploitation: string | null }>
    | null;
};

export async function fetchAdminPendingRefundsList(
  admin: SupabaseClient,
): Promise<FetchAdminPendingRefundsResult> {
  const { data, error } = await admin
    .from("pending_refunds")
    .select(
      `id, order_id, producer_id, amount_eur, reason, status, requested_at,
       decided_at, decision_reason,
       order:order_id ( code_commande ),
       producer:producer_id ( nom_exploitation )`,
    )
    .order("status", { ascending: true })
    .order("requested_at", { ascending: false })
    .limit(200);

  if (error) {
    return { rows: [], error: error.message };
  }

  const rows: AdminPendingRefundRow[] = ((data ?? []) as unknown as RawPendingRefund[]).map(
    (r) => {
      const order = Array.isArray(r.order) ? r.order[0] : r.order;
      const producer = Array.isArray(r.producer) ? r.producer[0] : r.producer;
      return {
        id: r.id,
        order_id: r.order_id,
        producer_id: r.producer_id,
        amount_eur: Number(r.amount_eur),
        reason: r.reason ?? null,
        status: r.status,
        requested_at: r.requested_at,
        decided_at: r.decided_at ?? null,
        decision_reason: r.decision_reason ?? null,
        order_code: order?.code_commande ?? null,
        producer_name: producer?.nom_exploitation ?? null,
      };
    },
  );

  return { rows, error: null };
}

// Badge agrégé de la section « Remboursements » (sidebar) : demandes en
// attente d'arbitrage + incidents techniques actifs (pending/retrying — même
// périmètre que la carte cockpit dashboard `refund_incidents_count`).
// Fail-open : toute erreur → la partie correspondante compte 0 (badge jamais
// bloquant pour le rendu de la sidebar).
export async function fetchRefundsBadgeCount(
  admin: SupabaseClient,
): Promise<number> {
  const [pendingRes, incidentsRes] = await Promise.all([
    admin
      .from("pending_refunds")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("refund_incidents")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "retrying"]),
  ]);

  return (pendingRes.count ?? 0) + (incidentsRes.count ?? 0);
}

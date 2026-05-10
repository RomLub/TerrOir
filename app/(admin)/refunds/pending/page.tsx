import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PendingRefundsClient } from "./_components/PendingRefundsClient";

// F-014 v2 (audit P0 sweep 2026-05-11) — Page admin liste pending_refunds
// + approve/deny. Server component qui fetch les rows + render le client
// avec server actions wired.
//
// Auth déjà gardée par app/(admin)/layout.tsx (redirect si !isAdmin).

export const dynamic = "force-dynamic";

type Row = {
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

export default async function AdminPendingRefundsPage() {
  const admin = createSupabaseAdminClient();

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
    console.error(`[ADMIN_PENDING_REFUNDS_FETCH_ERR] ${error.message}`);
    return (
      <div className="p-6">
        <h1 className="font-serif text-2xl">Refunds en attente</h1>
        <p className="mt-4 text-red-700">
          Erreur de chargement. Voir logs Vercel.
        </p>
      </div>
    );
  }

  const rows: Row[] = (data ?? []).map((r) => {
    const order = Array.isArray(r.order) ? r.order[0] : r.order;
    const producer = Array.isArray(r.producer) ? r.producer[0] : r.producer;
    return {
      id: r.id,
      order_id: r.order_id,
      producer_id: r.producer_id,
      amount_eur: Number(r.amount_eur),
      reason: (r.reason as string | null) ?? null,
      status: r.status as Row["status"],
      requested_at: r.requested_at as string,
      decided_at: (r.decided_at as string | null) ?? null,
      decision_reason: (r.decision_reason as string | null) ?? null,
      order_code:
        (order as { code_commande?: string | null } | undefined)
          ?.code_commande ?? null,
      producer_name:
        (producer as { nom_exploitation?: string | null } | undefined)
          ?.nom_exploitation ?? null,
    };
  });

  return <PendingRefundsClient rows={rows} />;
}

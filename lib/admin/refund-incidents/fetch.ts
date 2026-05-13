import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCursor, type ParsedCursor } from "@/lib/pagination/cursor";
import type {
  AdminRefundIncidentAttempt,
  AdminRefundIncidentDetail,
  AdminRefundIncidentRow,
  RefundIncidentKind,
  RefundIncidentStatus,
  RefundIncidentStatusFilter,
} from "./types";

// Helpers service_role pour la surface admin /refund-incidents (PR3
// feature/admin-new-surfaces, gap AUDIT_ADMIN.md §6 P0 #3).
//
// Pattern symétrique à lib/admin/producers/fetch.ts (PR1) : centralise
// la query Supabase + jointure orders pour le code commande / montant
// total + pagination cursor (created_at DESC + id DESC tie-breaker) +
// count exact pour le banner ListingHeader.
//
// Limite hardcodée 100 — alignée pattern admin (cf. audit perf-postgres-
// 2026-05-05 M-2 + NEW-1).

const PAGE_SIZE = 100;

type FetchAdminRefundIncidentsOptions = {
  cursor: ParsedCursor;
  // 'all' = pas de filtre. 'failed'/'resolved'/'resolved_manually' sont
  // des alias UI mappés vers les valeurs SQL réelles dans le helper.
  statusFilter: RefundIncidentStatusFilter;
};

export type FetchAdminRefundIncidentsResult = {
  rows: AdminRefundIncidentRow[];
  total: number;
  nextCursor: { created_at: string; id: string } | null;
  error: string | null;
};

// Shape Supabase brute après jointure orders. Le client remonte la
// jointure 1:1 soit en objet, soit en array selon la version — on
// normalise dans le mapper. `montant_total` est un `numeric` côté
// Postgres → string côté JS (préserve précision décimales).
type RawIncidentRow = {
  id: string;
  order_id: string;
  kind: RefundIncidentKind;
  status: RefundIncidentStatus;
  retry_count: number;
  max_retries: number;
  last_error_code: string | null;
  last_error_message: string | null;
  first_failed_event_at: string;
  created_at: string;
  resolved_at: string | null;
  order:
    | { code_commande: string | null; montant_total: number | string | null }
    | Array<{
        code_commande: string | null;
        montant_total: number | string | null;
      }>
    | null;
};

// Conversion montant euros (numeric) → cents (int) pour cohérence
// metadata audit log forensique (cents partout dans l'app côté Stripe).
// Garde-fou parsing : valeur invalide → 0 (préfère ne pas crasher la
// page admin si une row historique a montant_total NULL).
function toCents(amount: number | string | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  const num = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

// Mapping filtre UI → CHECK constraint Postgres. Ces alias regroupent
// plusieurs statuts SQL sous un même tab pour simplifier la prise de
// décision admin :
//   - failed = exhausted + aborted (incident terminé en échec)
//   - resolved = succeeded (résolu auto par le retry-runner)
//   - resolved_manually = manually_resolved (résolution explicite admin)
function applyStatusFilter<T extends { in(column: string, values: string[]): T; eq(column: string, value: string): T }>(
  query: T,
  filter: RefundIncidentStatusFilter,
): T {
  switch (filter) {
    case "all":
      return query;
    case "failed":
      return query.in("status", ["exhausted", "aborted"]);
    case "resolved":
      return query.eq("status", "succeeded");
    case "resolved_manually":
      return query.eq("status", "manually_resolved");
    case "pending":
    case "retrying":
      return query.eq("status", filter);
    default: {
      // Exhaustiveness check : si un nouveau filtre est ajouté sans
      // branche, TS pète à la compile.
      const _exhaustive: never = filter;
      return query;
    }
  }
}

export async function fetchAdminRefundIncidentsList(
  admin: SupabaseClient,
  opts: FetchAdminRefundIncidentsOptions,
): Promise<FetchAdminRefundIncidentsResult> {
  let itemsQuery = admin
    .from("refund_incidents")
    .select(
      "id, order_id, kind, status, retry_count, max_retries, last_error_code, last_error_message, first_failed_event_at, created_at, resolved_at, order:order_id ( code_commande, montant_total )",
    );
  let countQuery = admin
    .from("refund_incidents")
    .select("id", { count: "exact", head: true });

  itemsQuery = applyStatusFilter(itemsQuery, opts.statusFilter);
  countQuery = applyStatusFilter(countQuery, opts.statusFilter);

  const finalItemsQuery = applyCursor(itemsQuery, opts.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  const [itemsRes, countRes] = await Promise.all([finalItemsQuery, countQuery]);

  if (itemsRes.error) {
    return {
      rows: [],
      total: 0,
      nextCursor: null,
      error: itemsRes.error.message,
    };
  }
  if (countRes.error) {
    return {
      rows: [],
      total: 0,
      nextCursor: null,
      error: countRes.error.message,
    };
  }

  const data = (itemsRes.data ?? []) as unknown as RawIncidentRow[];

  const rows: AdminRefundIncidentRow[] = data.map((r) => {
    const order = Array.isArray(r.order) ? r.order[0] : r.order;
    return {
      id: r.id,
      orderId: r.order_id,
      orderCode: order?.code_commande ?? null,
      amountCents: toCents(order?.montant_total ?? null),
      kind: r.kind,
      status: r.status,
      retryCount: r.retry_count,
      maxRetries: r.max_retries,
      lastErrorCode: r.last_error_code,
      lastErrorMessage: r.last_error_message,
      firstFailedEventAt: r.first_failed_event_at,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    };
  });

  const last =
    data.length === PAGE_SIZE
      ? (data[PAGE_SIZE - 1] as { id: string; created_at: string })
      : null;

  return {
    rows,
    total: countRes.count ?? 0,
    nextCursor: last ? { created_at: last.created_at, id: last.id } : null,
    error: null,
  };
}

export const ADMIN_REFUND_INCIDENTS_PAGE_SIZE = PAGE_SIZE;

// Détail d'un incident — page /refund-incidents/[id]. Embarque tous les
// champs (y compris payment_intent_id, blocked_reason, resolution_note,
// consumer_id) utiles à l'investigation forensique. maybeSingle pour
// 404 propre côté call site.
export async function fetchAdminRefundIncidentDetail(
  admin: SupabaseClient,
  incidentId: string,
): Promise<
  | { incident: AdminRefundIncidentDetail; error: null }
  | { incident: null; error: string | null }
> {
  const { data, error } = await admin
    .from("refund_incidents")
    .select(
      "id, order_id, payment_intent_id, consumer_id, kind, status, retry_count, max_retries, last_error_code, last_error_message, blocked_reason, resolution_note, first_failed_event_at, resolved_at, created_at, updated_at, order:order_id ( code_commande, montant_total )",
    )
    .eq("id", incidentId)
    .maybeSingle();

  if (error) {
    return { incident: null, error: error.message };
  }
  if (!data) {
    return { incident: null, error: null };
  }

  const r = data as unknown as RawIncidentRow & {
    payment_intent_id: string;
    consumer_id: string | null;
    blocked_reason: string | null;
    resolution_note: string | null;
    updated_at: string;
  };
  const order = Array.isArray(r.order) ? r.order[0] : r.order;

  const incident: AdminRefundIncidentDetail = {
    id: r.id,
    orderId: r.order_id,
    orderCode: order?.code_commande ?? null,
    amountCents: toCents(order?.montant_total ?? null),
    kind: r.kind,
    status: r.status,
    retryCount: r.retry_count,
    maxRetries: r.max_retries,
    lastErrorCode: r.last_error_code,
    lastErrorMessage: r.last_error_message,
    firstFailedEventAt: r.first_failed_event_at,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    paymentIntentId: r.payment_intent_id,
    consumerId: r.consumer_id,
    blockedReason: r.blocked_reason,
    resolutionNote: r.resolution_note,
    updatedAt: r.updated_at,
  };

  return { incident, error: null };
}

// Liste des tentatives pour un incident, tri ASC (chronologique) — l'UI
// détail rend les tentatives dans l'ordre où elles ont eu lieu.
export async function fetchAdminRefundIncidentAttempts(
  admin: SupabaseClient,
  incidentId: string,
): Promise<{
  attempts: AdminRefundIncidentAttempt[];
  error: string | null;
}> {
  const { data, error } = await admin
    .from("refund_incident_attempts")
    .select(
      "id, attempt_number, outcome, stripe_error_code, stripe_error_type, stripe_error_message, stripe_request_id, stripe_refund_id, attempted_at",
    )
    .eq("refund_incident_id", incidentId)
    .order("attempted_at", { ascending: true });

  if (error) {
    return { attempts: [], error: error.message };
  }

  const attempts: AdminRefundIncidentAttempt[] = (data ?? []).map((a) => ({
    id: a.id as string,
    attemptNumber: a.attempt_number as number,
    outcome: a.outcome as string,
    stripeErrorCode: (a.stripe_error_code as string | null) ?? null,
    stripeErrorType: (a.stripe_error_type as string | null) ?? null,
    stripeErrorMessage: (a.stripe_error_message as string | null) ?? null,
    stripeRequestId: (a.stripe_request_id as string | null) ?? null,
    stripeRefundId: (a.stripe_refund_id as string | null) ?? null,
    attemptedAt: a.attempted_at as string,
  }));

  return { attempts, error: null };
}

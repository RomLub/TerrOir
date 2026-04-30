import Link from "next/link";
import { AdminPageHeader } from "@/components/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parisCalendarDayBoundsUtc } from "@/lib/format/paris-day-bounds";
import { parseSearchParams } from "./_lib/parse-search-params";
import { decodeCursor, encodeCursor } from "./_lib/cursor";
import { AuditLogsFilters } from "./_components/AuditLogsFilters";
import {
  AuditLogsTable,
  type AuditLogRow,
} from "./_components/AuditLogsTable";

const BASE_PATH = "/audit-logs";
const PAGE_SIZE = 50;

// Page admin de consultation du journal d'audit (T-080 Phase 1).
//
// Server component dynamique : lecture via createSupabaseServerClient()
// avec la session admin authentifiée — la RLS policy "audit_logs admin
// read" (migration 20260427100000) suffit, pas de bypass service_role.
//
// Pagination cursor-based sur (created_at DESC, id DESC). On fetch
// PAGE_SIZE+1 et on coupe : si la +1 existe, on génère un cursor
// "Plus ancien". Sinon on est en fin de liste.
//
// Edge case cursor : Supabase n'expose pas la comparaison row directe
// `(created_at, id) < (?, ?)` côté builder. On fait `.lte("created_at",
// cursor.createdAt)` puis on filtre client les lignes >= cursor en
// JavaScript. Coût négligeable (max PAGE_SIZE+1 rows) et garde la
// pagination déterministe sans ajouter d'index composite.
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function AuditLogsPage({ searchParams }: Props) {
  const filters = parseSearchParams(searchParams);
  const cursor = decodeCursor(filters.cursor);
  const supabase = createSupabaseServerClient();

  let query = supabase
    .from("audit_logs")
    .select(
      "id, user_id, event_type, metadata, ip_address, user_agent, created_at",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.eventTypes.length > 0) {
    query = query.in("event_type", filters.eventTypes);
  }
  if (filters.userId) {
    query = query.eq("user_id", filters.userId);
  }
  if (filters.dateFrom) {
    // Interprétation calendrier Europe/Paris : le jour saisi commence à
    // 00:00 Paris (UTC+1 ou UTC+2 selon DST), pas à 00:00Z. Cf. helper.
    const { startUtc } = parisCalendarDayBoundsUtc(filters.dateFrom);
    query = query.gte("created_at", startUtc.toISOString());
  }
  if (filters.dateTo) {
    // dateTo inclusif : on borne strictement à 00:00 Paris du lendemain.
    const { endUtc } = parisCalendarDayBoundsUtc(filters.dateTo);
    query = query.lt("created_at", endUtc.toISOString());
  }
  if (cursor) {
    query = query.lte("created_at", cursor.createdAt);
  }

  const { data, error } = await query;

  let errorMsg: string | null = null;
  let rows: AuditLogRow[] = [];
  let nextCursor: string | null = null;

  if (error) {
    errorMsg = error.message;
  } else {
    let raw = (data ?? []) as AuditLogRow[];
    if (cursor) {
      raw = raw.filter(
        (r) =>
          r.created_at < cursor.createdAt ||
          (r.created_at === cursor.createdAt && r.id < cursor.id),
      );
    }
    const hasMore = raw.length > PAGE_SIZE;
    rows = raw.slice(0, PAGE_SIZE);
    if (hasMore && rows.length > 0) {
      const last = rows[rows.length - 1]!;
      nextCursor = encodeCursor({
        createdAt: last.created_at,
        id: last.id,
      });
    }
  }

  // D1 : pre-fetch des user_ids visibles ayant une row dans public.producers
  // pour afficher un badge "Prod" dans la colonne user. Une seule query
  // bornée à la page courante (≤ 50 ids), pas de risque de charge.
  const userIds = Array.from(
    new Set(rows.map((r) => r.user_id).filter((u): u is string => !!u)),
  );
  let producerUserIds = new Set<string>();
  if (userIds.length > 0) {
    const { data: producerRows } = await supabase
      .from("producers")
      .select("user_id")
      .in("user_id", userIds);
    producerUserIds = new Set(
      (producerRows ?? [])
        .map((r) => (r as { user_id: string | null }).user_id)
        .filter((u): u is string => !!u),
    );
  }

  function buildPaginationHref(after: string | null): string {
    const params = new URLSearchParams();
    for (const t of filters.eventTypes) params.append("event_type", t);
    if (filters.userId) params.set("user_id", filters.userId);
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    if (after) params.set("after", after);
    const qs = params.toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  }

  const subtitle = errorMsg
    ? undefined
    : rows.length === 0
      ? "Aucun event sur cette page"
      : `${rows.length} event${rows.length > 1 ? "s" : ""} sur cette page`;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Sécurité"
        title="Journal d'audit"
        subtitle={subtitle}
        error={errorMsg}
      />

      <AuditLogsFilters
        selectedEventTypes={filters.eventTypes}
        userId={filters.userId}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
      />

      <AuditLogsTable rows={rows} producerUserIds={producerUserIds} />

      <nav className="mt-4 flex items-center justify-between">
        {cursor ? (
          <Link
            href={buildPaginationHref(null)}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
          >
            ← Retour début
          </Link>
        ) : (
          <span />
        )}
        {nextCursor ? (
          <Link
            href={buildPaginationHref(nextCursor)}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
          >
            Plus ancien →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}

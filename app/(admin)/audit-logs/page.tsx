import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { AdminPageHeader, MetricCard } from "@/components/ui";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { parisCalendarDayBoundsUtc } from "@/lib/format/paris-day-bounds";
import {
  consumeRateLimit,
  getAuditLogsEmailLookupRateLimit,
} from "@/lib/rate-limit";
import {
  extractRequestContext,
} from "@/lib/audit-logs/log-auth-event";
import { logLegalEvent } from "@/lib/audit-logs/log-legal-event";
import {
  lookupUserIdByEmail,
  maskEmail,
  SENTINEL_NOT_FOUND_USER_ID,
} from "@/lib/audit-logs/email-lookup";
import { getAuditLogStats } from "@/lib/audit-logs/stats";
import { getEventLabel } from "@/lib/audit-logs/labels";
import { parseSearchParams } from "./_lib/parse-search-params";
import { decodeCursor, encodeCursor } from "./_lib/cursor";
import { AuditLogsFilters } from "./_components/AuditLogsFilters";
import {
  AuditLogsTable,
  type AuditLogRow,
} from "./_components/AuditLogsTable";
import { SectionSkeleton } from "../_components/ContentSkeletons";

const BASE_PATH = "/audit-logs";
const PAGE_SIZE = 50;

// Page admin de consultation du journal d'audit (T-080 complète : labels
// humains T-084 + lookup email anti-énumération T-083 + 4 stats cards).
//
// Server component dynamique : lecture via createSupabaseServerClient()
// avec la session admin authentifiée — la RLS policy "audit_logs admin
// read" (migration 20260427100000) suffit, pas de bypass service_role
// pour la query principale. Le lookup email (T-083) utilise le service_role
// (bypass RLS) pour résoudre l'email → user_id sans que l'admin puisse
// distinguer "user inconnu" via la réponse.
//
// Pagination cursor-based sur (created_at DESC, id DESC). On fetch
// PAGE_SIZE+1 et on coupe : si la +1 existe, on génère un cursor
// "Plus ancien". Sinon on est en fin de liste.
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

// Coquille synchrone : l'en-tête s'affiche immédiatement (le shell admin
// reste fixe), le journal (query audit_logs + stats + lookup email éventuel)
// est streamé via <Suspense>. Le sous-titre et les stats dépendent du fetch,
// ils vivent donc dans le contenu streamé.
export default async function AuditLogsPage(props: Props) {
  const searchParams = await props.searchParams;
  const filters = parseSearchParams(searchParams);
  const cursor = decodeCursor(filters.cursor);

  return (
    <div>
      <AdminPageHeader eyebrow="Sécurité" title="Journal d'audit" />

      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <AuditLogsContent filters={filters} cursor={cursor} />
      </Suspense>
    </div>
  );
}

async function AuditLogsContent({
  filters,
  cursor,
}: {
  filters: ReturnType<typeof parseSearchParams>;
  cursor: ReturnType<typeof decodeCursor>;
}) {
  const supabase = await createSupabaseServerClient();

  // ─── T-083 lookup email → user_id avec rate-limit + audit log meta ──
  // Si filters.email présent, on consomme le rate-limit AVANT le lookup
  // pour empêcher un attaquant qui aurait compromis un compte admin de
  // bruteforcer l'oracle. Si rate-limited, on bypass le lookup et on
  // utilise le sentinel — l'UI reste uniforme.
  let resolvedEmailUserId: string | null = null;
  let emailRateLimited = false;
  if (filters.email) {
    const session = await getSessionUser();
    const adminId = session?.id ?? "anonymous";
    const rl = await consumeRateLimit(
      getAuditLogsEmailLookupRateLimit(),
      adminId,
    );
    if (!rl.success) {
      emailRateLimited = true;
      resolvedEmailUserId = SENTINEL_NOT_FOUND_USER_ID;
    } else {
      const lookup = await lookupUserIdByEmail(filters.email);
      resolvedEmailUserId = lookup.userId;
    }
    // Audit log meta — emit after lookup pour capturer found bool. Fail-
    // safe (logLegalEvent swallow), pas de re-throw qui casserait la page.
    void logLegalEvent({
      eventType: "admin_audit_logs_email_lookup",
      userId: session?.id ?? null,
      metadata: {
        masked_email: maskEmail(filters.email),
        user_resolved: resolvedEmailUserId !== SENTINEL_NOT_FOUND_USER_ID,
        rate_limited: emailRateLimited,
      },
    });
  }

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
  if (resolvedEmailUserId) {
    // Filtre via le user_id résolu côté serveur. Si le sentinel est utilisé
    // (email inconnu OU rate-limited), la query renverra 0 rows — réponse
    // uniforme pour l'admin (pas d'oracle énumération T-083).
    query = query.eq("user_id", resolvedEmailUserId);
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

  const [{ data, error }, statsRes] = await Promise.all([
    query,
    getAuditLogStats().catch((err) => {
      console.warn(
        `[AUDIT_LOGS_STATS_WARN] error=${(err as Error).message}`,
      );
      return null;
    }),
  ]);

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

  // Touch headers() pour matcher les warnings Next.js si jamais on
  // ajoute du request-aware logging plus tard. No-op fonctionnel.
  void extractRequestContext(await headers());

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
    if (filters.email) params.set("email", filters.email);
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    if (after) params.set("after", after);
    const qs = params.toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  }

  const subtitle = errorMsg
    ? null
    : rows.length === 0
      ? "Aucun event sur cette page"
      : `${rows.length} event${rows.length > 1 ? "s" : ""} sur cette page`;

  return (
    <>
      {errorMsg ? (
        <p className="mb-4 text-[13px] text-red-600" role="alert">
          {errorMsg}
        </p>
      ) : subtitle ? (
        <p className="mb-4 text-[13px] text-gray-500">{subtitle}</p>
      ) : null}

      {statsRes && (
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Events aujourd'hui"
            value={statsRes.todayCount}
            hint="Calendrier Europe/Paris"
          />
          <MetricCard
            label="Events 7 derniers jours"
            value={statsRes.last7daysCount}
            hint="Glissant — borné à 50 000 lignes"
          />
          <MetricCard
            label="Top event type 7j"
            value={statsRes.topEventType7d?.count ?? 0}
            hint={
              statsRes.topEventType7d
                ? getEventLabel(statsRes.topEventType7d.eventType)
                : "—"
            }
          />
          <MetricCard
            label="Échecs paiement / refund 7j"
            value={statsRes.failed7dCount}
            hint="Cluster order_*_failed + stripe_*_failed"
          />
        </section>
      )}

      <AuditLogsFilters
        selectedEventTypes={filters.eventTypes}
        userId={filters.userId}
        email={filters.email}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        emailRateLimited={emailRateLimited}
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
    </>
  );
}

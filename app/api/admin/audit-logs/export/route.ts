import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import { parisCalendarDayBoundsUtc } from "@/lib/format/paris-day-bounds";
import { parseSearchParams } from "@/app/(admin)/audit-logs/_lib/parse-search-params";
import {
  serializeAuditLogsToCsv,
  type AuditLogCsvRow,
} from "@/lib/audit-logs/serialize-csv";
import { buildExportFilename } from "@/lib/audit-logs/export-filename";
import {
  consumeRateLimit,
  getAuditLogsEmailLookupRateLimit,
} from "@/lib/rate-limit";
import {
  lookupUserIdByEmail,
  maskEmail,
  SENTINEL_NOT_FOUND_USER_ID,
} from "@/lib/audit-logs/email-lookup";
import { logLegalEvent } from "@/lib/audit-logs/log-legal-event";

// GET /api/admin/audit-logs/export — Export CSV des audit_logs filtrés.
//
// Réutilise le parseur de searchParams de la page /audit-logs (filtres
// event_type[], user_id, date_from, date_to) pour stricte cohérence. Le
// cursor `after` est ignoré : l'export n'est jamais paginé.
//
// Auth : `session.isAdmin` (pattern aligné /api/admin/producers/invite,
// /api/admin/gms-prices). Defensive in depth — le middleware sur
// admin.terroir-local.fr enforce déjà l'host-check.
//
// Lecture via createSupabaseServerClient (RLS-bound) : la policy
// "audit_logs admin read" suffit, pas de bypass service_role.
//
// Volume cap : 10 000 lignes max. On fetch 10 001 pour détecter saturation
// → si exactement 10 001, on truncate à 10 000 et on flag truncated=true
// (ligne d'avertissement injectée en row 1 du CSV + header HTTP custom).

const EXPORT_LIMIT = 10_000;

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // URLSearchParams → Record<string, string | string[]> compatible avec
  // parseSearchParams (qui attend une `searchParams` à la Next.js page).
  const url = new URL(request.url);
  const sp: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    sp[key] = values.length === 1 ? values[0] : values;
  }
  const filters = parseSearchParams(sp);
  const hasFilters =
    filters.eventTypes.length > 0 ||
    !!filters.userId ||
    !!filters.email ||
    !!filters.dateFrom ||
    !!filters.dateTo;

  // T-083 — symétrique page : si un email est posé, lookup serveur avec
  // rate-limit + audit log meta. Le sentinel garantit la réponse uniforme
  // (export vide si email inconnu OU rate-limited).
  let resolvedEmailUserId: string | null = null;
  let emailRateLimited = false;
  if (filters.email) {
    const adminId = session.id ?? "anonymous";
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
    void logLegalEvent({
      eventType: "admin_audit_logs_email_lookup",
      userId: session.id ?? null,
      metadata: {
        masked_email: maskEmail(filters.email),
        user_resolved: resolvedEmailUserId !== SENTINEL_NOT_FOUND_USER_ID,
        rate_limited: emailRateLimited,
        surface: "export",
      },
    });
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("audit_logs")
    .select(
      "id, user_id, event_type, metadata, ip_address, user_agent, created_at",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(EXPORT_LIMIT + 1);

  if (filters.eventTypes.length > 0) {
    query = query.in("event_type", filters.eventTypes);
  }
  if (filters.userId) {
    query = query.eq("user_id", filters.userId);
  }
  if (resolvedEmailUserId) {
    query = query.eq("user_id", resolvedEmailUserId);
  }
  if (filters.dateFrom) {
    const { startUtc } = parisCalendarDayBoundsUtc(filters.dateFrom);
    query = query.gte("created_at", startUtc.toISOString());
  }
  if (filters.dateTo) {
    const { endUtc } = parisCalendarDayBoundsUtc(filters.dateTo);
    query = query.lt("created_at", endUtc.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    return dbErrorResponse(error, "ADMIN_AUDIT_LOGS_EXPORT_ERR");
  }

  type Raw = {
    id: string;
    user_id: string | null;
    event_type: string;
    metadata: Record<string, unknown> | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
  };
  const raw = (data ?? []) as Raw[];
  const truncated = raw.length > EXPORT_LIMIT;
  const kept = truncated ? raw.slice(0, EXPORT_LIMIT) : raw;

  // Pre-fetch is_producer (cohérence avec colonne UI table — T-080
  // finitions D1). Une seule query bornée aux user_ids visibles
  // (≤ EXPORT_LIMIT distinct ids), pas de risque de charge.
  const userIds = Array.from(
    new Set(kept.map((r) => r.user_id).filter((u): u is string => !!u)),
  );
  let producerSet = new Set<string>();
  if (userIds.length > 0) {
    const { data: producerRows } = await supabase
      .from("producers")
      .select("user_id")
      .in("user_id", userIds);
    producerSet = new Set(
      (producerRows ?? [])
        .map((r) => (r as { user_id: string | null }).user_id)
        .filter((u): u is string => !!u),
    );
  }

  const rows: AuditLogCsvRow[] = kept.map((r) => ({
    created_at: r.created_at,
    event_type: r.event_type,
    user_id: r.user_id,
    ip_address: r.ip_address,
    user_agent: r.user_agent,
    metadata: r.metadata ?? {},
    is_producer: !!r.user_id && producerSet.has(r.user_id),
  }));

  const csv = serializeAuditLogsToCsv(rows, { truncated });
  const filename = buildExportFilename(new Date(), hasFilters);

  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
  if (truncated) {
    headers["X-Audit-Logs-Truncated"] = "true";
  }

  return new Response(csv, { status: 200, headers });
}

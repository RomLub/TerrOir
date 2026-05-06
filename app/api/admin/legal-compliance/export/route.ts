import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  listUsersWithCGUStatus,
  type StatusFilter,
} from "@/lib/legal/compliance";
import { serializeComplianceUsersToCsv } from "@/lib/legal/compliance-csv";
import { logLegalEvent } from "@/lib/audit-logs/log-legal-event";

// GET /api/admin/legal-compliance/export
// Export CSV (UTF-8 BOM, séparateur ';', RFC 4180) — Excel FR friendly.
//
// Pas de pagination : on tire jusqu'à EXPORT_LIMIT users en une passe.
// Pré-launch (~50 users), pas de risque de saturation. Pour > 5000 :
// background job dans une itération future (TODO non urgent).
//
// Audit log : event_type 'admin_legal_compliance_exported' avec metadata
// { status, search, count, truncated }. Cluster legal_compliance dédié
// (lib/audit-logs/log-legal-event.ts), découplé du pipe auth pour rester
// non-conflictuel avec d'autres chantiers en parallèle.

const EXPORT_LIMIT = 10_000;

const VALID_STATUSES: StatusFilter[] = [
  "all",
  "accepted_current",
  "accepted_outdated",
  "never_accepted",
];

function parseStatus(value: string | null): StatusFilter {
  if (value && (VALID_STATUSES as string[]).includes(value)) {
    return value as StatusFilter;
  }
  return "all";
}

function buildFilename(now: Date, hasFilters: boolean): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const suffix = hasFilters ? "_filtered" : "";
  return `legal-compliance_${yyyy}-${mm}-${dd}${suffix}.csv`;
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));
  const search = url.searchParams.get("search") ?? "";
  const hasFilters = status !== "all" || search.trim() !== "";

  try {
    const result = await listUsersWithCGUStatus({
      status,
      search,
      limit: EXPORT_LIMIT,
      offset: 0,
    });

    const csv = serializeComplianceUsersToCsv(result.users);
    const filename = buildFilename(new Date(), hasFilters);

    // Audit log — fail-safe : un échec d'écriture audit ne casse PAS l'export
    // (logLegalEvent swallow + console.warn).
    await logLegalEvent({
      eventType: "admin_legal_compliance_exported",
      userId: session.id,
      metadata: {
        status,
        search: search.trim() || null,
        count: result.users.length,
        truncated: result.total > EXPORT_LIMIT,
      },
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = (err as Error).message ?? "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

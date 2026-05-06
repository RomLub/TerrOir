import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  listUsersWithCGUStatus,
  type StatusFilter,
  DEFAULT_PAGE_SIZE,
} from "@/lib/legal/compliance";

// GET /api/admin/legal-compliance/users
// Liste paginée des users + statut CGU. Filtre par status (all | accepted_current
// | accepted_outdated | never_accepted) et search partial sur email.
//
// Auth admin only. La RLS sur public.users impose service_role pour voir tous
// les users (pattern lib/legal/compliance.ts).

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

function parsePage(value: string | null): number {
  if (!value) return 1;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));
  const search = url.searchParams.get("search") ?? "";
  const page = parsePage(url.searchParams.get("page"));
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;

  try {
    const result = await listUsersWithCGUStatus({
      status,
      search,
      limit,
      offset,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message ?? "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

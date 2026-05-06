import type { StatusFilter } from "@/lib/legal/compliance";

// Parseur défensif des searchParams de /admin/legal-compliance.
// status : whitelist stricte, défaut = "never_accepted" (focus pré-launch
// sur les héritiers sans CGU peuplée).
// search : trimmé, max 100 chars.
// page   : entier ≥ 1.

const VALID_STATUSES: StatusFilter[] = [
  "all",
  "accepted_current",
  "accepted_outdated",
  "never_accepted",
];

const DEFAULT_STATUS: StatusFilter = "never_accepted";
const MAX_SEARCH_LEN = 100;

function pickFirst(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export type ParsedFilters = {
  status: StatusFilter;
  search: string;
  page: number;
};

export function parseSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): ParsedFilters {
  const rawStatus = pickFirst(searchParams.status);
  const status: StatusFilter =
    rawStatus && (VALID_STATUSES as string[]).includes(rawStatus)
      ? (rawStatus as StatusFilter)
      : DEFAULT_STATUS;

  const rawSearch = pickFirst(searchParams.search);
  const search = (rawSearch ?? "").slice(0, MAX_SEARCH_LEN).trim();

  const rawPage = pickFirst(searchParams.page);
  const parsedPage = rawPage ? Number.parseInt(rawPage, 10) : 1;
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  return { status, search, page };
}

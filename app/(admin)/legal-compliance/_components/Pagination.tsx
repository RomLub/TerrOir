import Link from "next/link";
import type { StatusFilter } from "@/lib/legal/compliance";

const BASE_PATH = "/legal-compliance";

function buildHref(
  status: StatusFilter,
  search: string,
  page: number,
): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (search) params.set("search", search);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
}

type Props = {
  status: StatusFilter;
  search: string;
  page: number;
  totalPages: number;
  total: number;
};

export function CompliancePagination({
  status,
  search,
  page,
  totalPages,
  total,
}: Props) {
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-gray-600">
      <span>
        {total} utilisateur{total > 1 ? "s" : ""} · Page {page} sur{" "}
        {totalPages}
      </span>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link
            href={buildHref(status, search, page - 1)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 transition-colors hover:bg-gray-50"
          >
            ← Précédent
          </Link>
        ) : (
          <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-gray-400">
            ← Précédent
          </span>
        )}
        {hasNext ? (
          <Link
            href={buildHref(status, search, page + 1)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 transition-colors hover:bg-gray-50"
          >
            Suivant →
          </Link>
        ) : (
          <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-gray-400">
            Suivant →
          </span>
        )}
      </div>
    </nav>
  );
}

import Link from "next/link";
import type { StatusFilter } from "@/lib/legal/compliance";

const BASE_PATH = "/legal-compliance";
const EXPORT_PATH = "/api/admin/legal-compliance/export";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "accepted_current", label: "À jour" },
  { value: "accepted_outdated", label: "Obsolète" },
  { value: "never_accepted", label: "Jamais acceptée" },
];

function buildHref(status: StatusFilter, search: string): string {
  const params = new URLSearchParams();
  params.set("status", status);
  if (search) params.set("search", search);
  return `${BASE_PATH}?${params.toString()}`;
}

function buildExportHref(status: StatusFilter, search: string): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (search) params.set("search", search);
  const qs = params.toString();
  return qs ? `${EXPORT_PATH}?${qs}` : EXPORT_PATH;
}

type Props = {
  status: StatusFilter;
  search: string;
};

export function ComplianceFilters({ status, search }: Props) {
  const exportHref = buildExportHref(status, search);

  return (
    <section className="mb-6 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      {/* Form GET pour search. Le status courant est porté en hidden input
          pour le préserver lors d'un submit search. */}
      <form
        method="get"
        action={BASE_PATH}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <input type="hidden" name="status" value={status} />

        <label className="flex flex-1 flex-col gap-1 text-[12px] text-gray-600 sm:max-w-md">
          Rechercher par email
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="email@exemple.com"
            maxLength={100}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={exportHref}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Exporter CSV
          </a>
          {(status !== "never_accepted" || search) && (
            <Link
              href={BASE_PATH}
              className="text-[13px] text-gray-600 underline hover:text-gray-900"
            >
              Réinitialiser
            </Link>
          )}
          <button
            type="submit"
            className="rounded-md bg-terroir-green-700 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-terroir-green-800"
          >
            Appliquer
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap gap-1 border-t border-gray-200 pt-4">
        {STATUS_TABS.map((tab) => {
          const active = status === tab.value;
          return (
            <Link
              key={tab.value}
              href={buildHref(tab.value, search)}
              aria-current={active ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-terroir-green-700 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

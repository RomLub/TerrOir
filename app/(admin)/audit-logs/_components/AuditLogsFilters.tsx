import Link from "next/link";
import { ALL_EVENT_TYPES, type AuditEventType } from "../_lib/event-types";
import {
  categorizeEventType,
  CATEGORY_PALETTE,
} from "../_lib/categorize-event-type";

const BASE_PATH = "/audit-logs";
const EXPORT_PATH = "/api/admin/audit-logs/export";

type Props = {
  selectedEventTypes: AuditEventType[];
  userId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

// Construit l'URL pour toggler un event_type côté pills. Préserve les
// autres filtres mais reset le cursor (toute mutation de filtre revient
// à la 1re page — sinon le cursor d'une vue antérieure pourrait pointer
// dans le vide).
function toggleEventTypeHref(
  eventType: AuditEventType,
  selected: AuditEventType[],
  userId: string | null,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  const next = selected.includes(eventType)
    ? selected.filter((t) => t !== eventType)
    : [...selected, eventType];
  const params = new URLSearchParams();
  for (const t of next) params.append("event_type", t);
  if (userId) params.set("user_id", userId);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  const qs = params.toString();
  return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
}

// Construit l'URL d'export CSV en propageant les filtres courants (sans
// le cursor de pagination, l'export n'étant jamais paginé). Le bouton est
// un simple <a> : le browser télécharge via Content-Disposition côté
// route handler /api/admin/audit-logs/export.
function buildExportHref(
  selected: AuditEventType[],
  userId: string | null,
  dateFrom: string | null,
  dateTo: string | null,
): string {
  const params = new URLSearchParams();
  for (const t of selected) params.append("event_type", t);
  if (userId) params.set("user_id", userId);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  const qs = params.toString();
  return qs ? `${EXPORT_PATH}?${qs}` : EXPORT_PATH;
}

export function AuditLogsFilters({
  selectedEventTypes,
  userId,
  dateFrom,
  dateTo,
}: Props) {
  const selectedSet = new Set<AuditEventType>(selectedEventTypes);
  const hasActiveFilters =
    selectedEventTypes.length > 0 || !!userId || !!dateFrom || !!dateTo;

  return (
    <section className="mb-6 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      {/* Form GET pour user_id + date range. Les event_types sont préservés
          via hidden inputs : leur sélection est portée par les pills, mais
          quand l'admin clique "Appliquer" sur les autres champs, on ne
          veut pas perdre la sélection courante. */}
      <form
        method="get"
        action={BASE_PATH}
        className="grid gap-3 sm:grid-cols-3"
      >
        {selectedEventTypes.map((t) => (
          <input key={t} type="hidden" name="event_type" value={t} />
        ))}

        <label className="flex flex-col gap-1 text-[12px] text-gray-600">
          User ID (UUID)
          <input
            type="text"
            name="user_id"
            defaultValue={userId ?? ""}
            placeholder="00000000-0000-0000-0000-000000000000"
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700"
          />
        </label>

        <label className="flex flex-col gap-1 text-[12px] text-gray-600">
          Depuis
          <input
            type="date"
            name="date_from"
            defaultValue={dateFrom ?? ""}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700"
          />
        </label>

        <label className="flex flex-col gap-1 text-[12px] text-gray-600">
          {"Jusqu'au"}
          <input
            type="date"
            name="date_to"
            defaultValue={dateTo ?? ""}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700"
          />
        </label>

        <div className="flex flex-wrap items-center justify-end gap-3 sm:col-span-3">
          <a
            href={buildExportHref(
              selectedEventTypes,
              userId,
              dateFrom,
              dateTo,
            )}
            title="Limité à 10 000 lignes — affinez vos filtres pour un export complet"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Exporter CSV
          </a>
          <span className="text-[11px] italic text-gray-500">
            Limité à 10 000 lignes
          </span>
          {hasActiveFilters && (
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

      <div className="mt-4 border-t border-gray-200 pt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-600">
          Event types{" "}
          <span className="font-mono normal-case text-gray-500">
            ({selectedEventTypes.length}/{ALL_EVENT_TYPES.length})
          </span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_EVENT_TYPES.map((eventType) => {
            const cat = categorizeEventType(eventType);
            const palette = CATEGORY_PALETTE[cat];
            const isActive = selectedSet.has(eventType);
            const href = toggleEventTypeHref(
              eventType,
              selectedEventTypes,
              userId,
              dateFrom,
              dateTo,
            );
            return (
              <Link
                key={eventType}
                href={href}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  isActive
                    ? `${palette.bg} ${palette.text} ring-1 ring-inset ring-current`
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isActive ? palette.dot : "bg-gray-400"
                  }`}
                />
                {eventType}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

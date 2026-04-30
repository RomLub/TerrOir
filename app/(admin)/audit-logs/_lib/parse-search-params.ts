import { ALL_EVENT_TYPES, type AuditEventType } from "./event-types";

// Parser server-side strict : tout ce qui n'est pas valide est ignoré
// silencieusement (pas d'erreur 400 à un admin sur une URL bookmarkée
// avec un event_type renommé entre temps).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_TYPES: ReadonlySet<string> = new Set(ALL_EVENT_TYPES);

export type AuditLogsFilters = {
  eventTypes: AuditEventType[];
  userId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  cursor: string | null;
};

export function parseSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): AuditLogsFilters {
  const raw = searchParams.event_type;
  const eventTypeRaw = Array.isArray(raw) ? raw : raw ? [raw] : [];
  // dedupe (un admin pourrait copier 2x le même type via toggle bug),
  // garde l'ordre de 1re apparition.
  const seen = new Set<string>();
  const eventTypes: AuditEventType[] = [];
  for (const t of eventTypeRaw) {
    if (typeof t === "string" && VALID_TYPES.has(t) && !seen.has(t)) {
      seen.add(t);
      eventTypes.push(t as AuditEventType);
    }
  }

  const userIdRaw =
    typeof searchParams.user_id === "string" ? searchParams.user_id : null;
  const userId = userIdRaw && UUID_REGEX.test(userIdRaw) ? userIdRaw : null;

  const dateFromRaw =
    typeof searchParams.date_from === "string" ? searchParams.date_from : null;
  const dateFrom =
    dateFromRaw && DATE_REGEX.test(dateFromRaw) ? dateFromRaw : null;

  const dateToRaw =
    typeof searchParams.date_to === "string" ? searchParams.date_to : null;
  const dateTo = dateToRaw && DATE_REGEX.test(dateToRaw) ? dateToRaw : null;

  const cursor =
    typeof searchParams.after === "string" ? searchParams.after : null;

  return { eventTypes, userId, dateFrom, dateTo, cursor };
}

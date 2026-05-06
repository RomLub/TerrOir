import { ALL_EVENT_TYPES, type AuditEventType } from "./event-types";

// Parser server-side strict : tout ce qui n'est pas valide est ignoré
// silencieusement (pas d'erreur 400 à un admin sur une URL bookmarkée
// avec un event_type renommé entre temps).
//
// T-083 : `email` est ajouté aux filtres pour le lookup user_id avec
// garantie anti-énumération côté caller (cf. lib/audit-logs/email-lookup.ts).
// Stocké brut ici (pas de hash côté parser) — on garde le email tel saisi
// pour pouvoir le ré-injecter dans le form (defaultValue) et l'afficher
// dans la chip "Filtre actif". Le lookup serveur le normalise en aval.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EMAIL_LEN = 320;

const VALID_TYPES: ReadonlySet<string> = new Set(ALL_EVENT_TYPES);

export type AuditLogsFilters = {
  eventTypes: AuditEventType[];
  userId: string | null;
  email: string | null;
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

  const emailRaw =
    typeof searchParams.email === "string" ? searchParams.email.trim() : null;
  const email =
    emailRaw && emailRaw.length > 0 && emailRaw.length <= MAX_EMAIL_LEN
      ? emailRaw
      : null;

  const dateFromRaw =
    typeof searchParams.date_from === "string" ? searchParams.date_from : null;
  const dateFrom =
    dateFromRaw && DATE_REGEX.test(dateFromRaw) ? dateFromRaw : null;

  const dateToRaw =
    typeof searchParams.date_to === "string" ? searchParams.date_to : null;
  const dateTo = dateToRaw && DATE_REGEX.test(dateToRaw) ? dateToRaw : null;

  const cursor =
    typeof searchParams.after === "string" ? searchParams.after : null;

  return { eventTypes, userId, email, dateFrom, dateTo, cursor };
}

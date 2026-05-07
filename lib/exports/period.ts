// Validation et parsing des paramètres de période (from/to) pour les exports
// comptabilité. Format attendu : YYYY-MM-DD (ISO 8601 date).
//
// Sémantique (bugs-P1-2, 2026-05-12) :
//   - dates interprétées en zone Europe/Paris (locale française légale,
//     reference DGCCRF). Une commande validée le 7 mai à 00:30 Paris
//     (= 6 mai 22:30 UTC en heure d'été) DOIT tomber dans la journée
//     comptable du 7 mai, pas du 6.
//   - `from` inclus à 00:00:00 Europe/Paris → UTC correspondant
//   - `to` inclus jusqu'à 23:59:59.999 Europe/Paris → UTC correspondant
//   - period max : 366 jours (1 année comptable + 1 jour pour absorber 366
//     jours bissextiles)
//   - retourne ISO timestamps UTC pour les comparaisons SQL côté Supabase
//     (les colonnes timestamptz sont stockées en UTC).

import { TZDate } from "@date-fns/tz";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const MS_PER_DAY = 86_400_000;
export const EXPORT_TIMEZONE = "Europe/Paris";

export type ParsedPeriod = {
  fromIso: string;
  // toEndOfDayIso = `${to}T23:59:59.999` Europe/Paris converti en UTC pour
  // matcher complètement le jour tail (created_at/completed_at au format
  // timestamptz est stocké en UTC, comparé à des bornes UTC).
  toEndOfDayIso: string;
};

export type ParsePeriodResult =
  | { ok: true; period: ParsedPeriod }
  | { ok: false; error: string };

// Construit une instance TZDate à partir d'un YYYY-MM-DD + composantes
// horaires interprétées en zone Europe/Paris. Utilise le constructor string
// `${date}T${hh}:${mm}:${ss}.${ms}` qui, en présence d'une timeZone, est
// interprété comme l'heure locale de cette zone.
function tzDateFromIsoDate(
  date: string,
  hh: number,
  mm: number,
  ss: number,
  ms: number,
): TZDate {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const dateTimeStr = `${date}T${pad(hh)}:${pad(mm)}:${pad(ss)}.${pad(ms, 3)}`;
  return new TZDate(dateTimeStr, EXPORT_TIMEZONE);
}

export function parsePeriodParams(args: {
  from: string | null;
  to: string | null;
}): ParsePeriodResult {
  const { from, to } = args;
  if (!from || !to) {
    return { ok: false, error: "Paramètres from et to requis (format YYYY-MM-DD)" };
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return { ok: false, error: "Format de date invalide (attendu YYYY-MM-DD)" };
  }
  const fromDate = tzDateFromIsoDate(from, 0, 0, 0, 0);
  const toDate = tzDateFromIsoDate(to, 23, 59, 59, 999);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return { ok: false, error: "Date invalide" };
  }
  if (fromDate > toDate) {
    return { ok: false, error: "from doit être <= to" };
  }
  const diffDays = (toDate.getTime() - fromDate.getTime()) / MS_PER_DAY;
  if (diffDays > MAX_DAYS) {
    return {
      ok: false,
      error: `Période trop longue (max ${MAX_DAYS} jours)`,
    };
  }
  // TZDate.toISOString() retourne avec offset (`+02:00` ou `+01:00`), pas
  // une string UTC pure ("...Z"). On normalise via new Date(tzd.getTime())
  // qui produit l'ISO UTC compatible avec les comparaisons SQL Supabase
  // (timestamptz stocké en UTC).
  return {
    ok: true,
    period: {
      fromIso: new Date(fromDate.getTime()).toISOString(),
      toEndOfDayIso: new Date(toDate.getTime()).toISOString(),
    },
  };
}

// Format helper pour les noms de fichier d'export (sans T/colon).
export function formatPeriodForFilename(args: {
  from: string;
  to: string;
}): string {
  return `${args.from}_${args.to}`;
}

// Formatte un timestamptz ISO (UTC) en YYYY-MM-DD interprété en Europe/Paris.
// Utilisé par les routes export CSV pour afficher la date locale française
// dans les colonnes "date_commande" / "date_validation" — référence DGCCRF.
//
// Une commande complétée le 7 mai à 00:30 Paris (= "2026-05-06T22:30:00.000Z"
// en UTC) doit s'afficher "2026-05-07" en colonne CSV, pas "2026-05-06".
export function formatDateInExportTimezone(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "";
  const tzd = new TZDate(isoTimestamp, EXPORT_TIMEZONE);
  const y = tzd.getFullYear();
  const m = String(tzd.getMonth() + 1).padStart(2, "0");
  const d = String(tzd.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

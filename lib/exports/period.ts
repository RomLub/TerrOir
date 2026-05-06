// Validation et parsing des paramètres de période (from/to) pour les exports
// comptabilité. Format attendu : YYYY-MM-DD (ISO 8601 date).
//
// Sémantique :
//   - `from` inclus, `to` inclus (date complète jusqu'à 23:59:59 UTC)
//   - period max : 366 jours (1 année comptable + 1 jour pour absorber 366
//     jours bissextiles)
//   - retourne ISO timestamps pour les comparaisons SQL côté Supabase.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const MS_PER_DAY = 86_400_000;

export type ParsedPeriod = {
  fromIso: string;
  // toEndOfDayIso = `${to}T23:59:59.999Z` pour matcher complètement le jour
  // tail (created_at au format timestamptz peut tomber après minuit UTC).
  toEndOfDayIso: string;
};

export type ParsePeriodResult =
  | { ok: true; period: ParsedPeriod }
  | { ok: false; error: string };

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
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
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
  return {
    ok: true,
    period: {
      fromIso: fromDate.toISOString(),
      toEndOfDayIso: toDate.toISOString(),
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

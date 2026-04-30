// Helper Europe/Paris pour les bornes journalières côté serveur. Utilisé
// par la page admin /audit-logs (filtres date_from / date_to) pour
// interpréter une string YYYY-MM-DD comme un jour calendaire local Paris,
// pas comme une borne UTC à 00:00Z.
//
// Implémentation pure stdlib via Intl.DateTimeFormat — pas de dépendance
// `date-fns-tz` à ajouter pour ce seul usage. Algorithme :
//
//   1. On veut l'instant UTC où Paris affiche `YYYY-MM-DDT00:00:00`.
//   2. On part d'un probe = `${YYYY-MM-DD}T00:00:00Z` (= la même chose
//      mais lue en UTC). Ce probe ne pointe pas le bon instant (décalage
//      d'1h ou 2h selon DST), il sert juste de point d'entrée stable.
//   3. On formatte ce probe dans la timezone Europe/Paris pour obtenir
//      l'heure Paris correspondante. La différence (instant Paris formaté
//      → relu comme UTC) - probe = offset Paris à ce moment.
//   4. UTC ciblé = probe - offset. Garantie : à cet instant UTC, Paris
//      affiche bien `YYYY-MM-DDT00:00:00`.
//
// Gère DST automatiquement (l'offset varie selon la saison + transitions
// dernier dimanche de mars / dernier dimanche d'octobre).

const PARIS_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function getParisOffsetMs(utcInstant: Date): number {
  const parts = Object.fromEntries(
    PARIS_DATE_FORMATTER.formatToParts(utcInstant).map((p) => [
      p.type,
      p.value,
    ]),
  );
  // Intl peut renvoyer "24" pour minuit pile sur certaines plateformes
  // (Chromium V8 a longtemps eu ce comportement). On normalise en 0.
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcInstant.getTime();
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function parisCalendarDayStartUtc(yyyymmdd: string): Date {
  if (!DATE_REGEX.test(yyyymmdd)) {
    throw new Error(`parisCalendarDayStartUtc: invalid date "${yyyymmdd}"`);
  }
  const probe = new Date(`${yyyymmdd}T00:00:00Z`);
  const offset = getParisOffsetMs(probe);
  return new Date(probe.getTime() - offset);
}

// Renvoie les bornes UTC d'un jour calendaire Paris : [start, end[ où
// `start` est l'instant UTC où Paris ouvre la journée, et `end` celui
// où Paris ouvre la suivante. À utiliser comme `gte(start) && lt(end)`
// dans une query SQL pour filtrer les rows tombant dans ce jour Paris.
export function parisCalendarDayBoundsUtc(yyyymmdd: string): {
  startUtc: Date;
  endUtc: Date;
} {
  const startUtc = parisCalendarDayStartUtc(yyyymmdd);
  // +24h naïves est faux (pourrait sauter une transition DST). On
  // re-calcule depuis le YYYY-MM-DD du lendemain pour être robuste.
  const probe = new Date(`${yyyymmdd}T00:00:00Z`);
  probe.setUTCDate(probe.getUTCDate() + 1);
  const nextDay = probe.toISOString().slice(0, 10);
  const endUtc = parisCalendarDayStartUtc(nextDay);
  return { startUtc, endUtc };
}

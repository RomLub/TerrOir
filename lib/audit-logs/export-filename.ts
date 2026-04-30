// Génération du nom de fichier pour l'export CSV des audit_logs (T-080
// Phase 2). Le timestamp est rendu en heure locale Europe/Paris (cohérence
// avec le reste de l'app, cf. helper paris-day-bounds), pas en UTC, pour
// que l'admin retrouve facilement l'export téléchargé "vers 14h cet après-
// midi" sans avoir à mentaliser le décalage.
//
// Format : audit-logs_YYYY-MM-DD_HHmm[_filtered].csv
// Le suffixe _filtered est ajouté quand au moins un filtre est actif (event
// types, user_id, date range), pour distinguer dans les téléchargements
// successifs un export "tout le journal" d'un export ciblé. Pas de
// génération de nom enrichi par event_type ou date range : trop de cas
// pourris (multi-types, dates partielles, caractères spéciaux dans UUID),
// l'admin peut renommer.

const PARIS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function buildExportFilename(now: Date, hasFilters: boolean): string {
  const parts = Object.fromEntries(
    PARIS_FORMATTER.formatToParts(now).map((p) => [p.type, p.value]),
  );
  // Intl peut renvoyer "24" pour minuit pile sur certaines plateformes
  // (Chromium V8 historique). Normalise en "00" pour cohérence filename.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${hour}${parts.minute}`;
  const suffix = hasFilters ? "_filtered" : "";
  return `audit-logs_${date}_${time}${suffix}.csv`;
}

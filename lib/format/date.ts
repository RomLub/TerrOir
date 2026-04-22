// Formatters de date partagés (chantier consolidation admin, Phase A).
// Extraits de 3 dup quasi-identiques dans gestion-producteurs, producer-
// interests/LeadsTable et suivi-commandes. Client-safe (Intl natif, pas de
// server-only), utilisables depuis composants 'use client'.

type FormatOpts = { year?: boolean };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDateFr(
  iso: string | null | undefined,
  opts: FormatOpts = {},
): string {
  if (!iso) return "—";
  // Normalise les date-only (YYYY-MM-DD) en local midnight pour éviter le
  // shift UTC qui peut décaler d'un jour selon la timezone côté client
  // (ex: admin à l'étranger, ou Node UTC côté SSR). Préserve la défense
  // historique de formatDateShort.
  const parsed = DATE_ONLY.test(iso) ? `${iso}T00:00:00` : iso;
  const d = new Date(parsed);
  if (Number.isNaN(d.getTime())) return iso;
  const includeYear = opts.year !== false;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
  });
}

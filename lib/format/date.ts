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
  // Normalise les date-only (YYYY-MM-DD) en UTC midnight pour cohérence
  // globale : combiné au `timeZone: "Europe/Paris"` du formatter ci-dessous,
  // l'instant UTC midnight projette en 01:00 (hiver) ou 02:00 (été) Paris
  // — toujours le même jour calendaire que le YYYY-MM-DD reçu, peu importe
  // la timezone du runtime (Node UTC en SSR, browser local en CSR, ou
  // browser exotique type Tokyo/NY). Anchor en local midnight (legacy)
  // était vulnérable aux browsers TZ très loin de Paris.
  const parsed = DATE_ONLY.test(iso) ? `${iso}T00:00:00Z` : iso;
  const d = new Date(parsed);
  if (Number.isNaN(d.getTime())) return iso;
  const includeYear = opts.year !== false;
  // timeZone "Europe/Paris" explicite : les pages côté SSR (Node UTC)
  // affichaient autrement les dates de la journée Paris décalées d'1 ou 2 h
  // (exemple : un événement créé à 23h45 Paris pendant la DST apparaissait
  // sur la journée du lendemain en UTC). DST géré automatiquement par le
  // runtime, pas de dépendance date-fns-tz à ajouter.
  return d.toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
  });
}

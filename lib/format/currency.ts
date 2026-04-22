// Formatter monétaire euro (chantier consolidation admin, Phase A). Extrait
// de suivi-commandes, anticipé pour les futurs écrans admin qui afficheront
// du total / net producteur / commission. Virgule française + espace insécable.

export function formatEuro(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(2).replace(".", ",")} €`;
}

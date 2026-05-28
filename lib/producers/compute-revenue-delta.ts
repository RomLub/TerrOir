// Calcul du delta % « revenus cette semaine vs semaine passée » affiché sur
// la StatCard du dashboard producteur. Helper pur, isolé, testable.
//
// Cas limites (table de vérité validée 2026-05-28) :
//   - last=0, week=0   → null (« — » : pas de donnée)
//   - last=0, week>0   → null (« — » : pas de base de comparaison)
//   - last<seuil       → null (« — » : baseline trivial, delta non significatif)
//   - last>=seuil, week=0 → -100 (vraie chute, légitime)
//   - last>=seuil, week>0 → calcul normal arrondi à l'entier

/**
 * Seuil minimum (en euros) du revenu de référence pour qu'un delta % soit
 * significatif. En dessous, on retourne `null` plutôt qu'un pourcentage qui
 * serait dominé par le bruit de micro-transactions (commandes test à 0,01 €,
 * résidus, etc.) — une baisse "-100%" calculée sur 0,30 € de baseline ne
 * communique rien d'utile au producteur.
 *
 * Valeur de départ assumée, à réajuster avec les données terrain (comme le
 * plafond capacité). 5 € filtre le bruit sans masquer l'activité d'un petit
 * producteur.
 *
 * Unité : `montant_total` est stocké en euros (NUMERIC à 2 décimales) côté
 * `public.orders`. Si l'unité changeait (passage en centimes), adapter cette
 * constante.
 */
export const MIN_BASELINE_REVENUE_FOR_DELTA = 5;

export function computeRevenueDelta(
  revenueWeek: number,
  revenueLastWeek: number,
): number | null {
  if (revenueLastWeek < MIN_BASELINE_REVENUE_FOR_DELTA) return null;
  return Math.round(((revenueWeek - revenueLastWeek) / revenueLastWeek) * 100);
}

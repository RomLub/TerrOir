/**
 * Floute les coordonnées producteur avant exposition côté consumer.
 *
 * Rationale sécurité (décision comité review T-200, rounds 1 + 2) :
 *   - En élevage fermier, l'adresse de l'exploitation = domicile du producteur
 *     dans la majorité des cas. Exposer la lat/lng brute revient à publier
 *     l'adresse personnelle du producteur sur internet.
 *   - 2 décimales = ~1.1 km de précision en latitude, ~750 m en longitude à
 *     47° (Sarthe). Suffisant pour ne pas pinpoint la maison, suffisant pour
 *     un widget distance "à vol d'oiseau".
 *
 * Compromis fonctionnel :
 *   - L'erreur d'arrondi (max ~1 km) est négligeable devant les distances
 *     réelles affichées côté UI (référence GMS_DISTANCE_KM_REFERENCE = 1500 km
 *     pour le score carbone). Le widget distance reste utile et honnête.
 *   - Le helper rejette aussi NaN / Infinity en null pour fail-safe : un
 *     producer dont la géocodage a échoué ne se retrouve jamais avec une
 *     coordonnée corrompue côté client.
 *
 * Round 1 : extrait dans fetch-public.ts pour la fiche publique slug.
 * Round 2 : extrait en helper partagé et appliqué également à la route
 *           /api/producers/search (carte + listing producteurs) qui exposait
 *           encore les coordonnées brutes via la RPC search_producers.
 */
export function roundCoord(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

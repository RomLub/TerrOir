/**
 * Floute les coordonnées producteur avant exposition côté consumer.
 *
 * # Modèle de menace adressé
 *
 * Surface : toute route ou Server Component qui sérialise un objet producer
 * vers un client (consumer non authentifié, consumer authentifié, page admin
 * partagée). En élevage fermier, l'adresse de l'exploitation = domicile du
 * producteur dans la majorité des cas. Exposer la lat/lng brute (6+ décimales
 * = précision ~10 cm) revient à publier l'adresse personnelle du producteur
 * sur internet, indexable et scrappable.
 *
 * Attaques couvertes :
 *   1. Scrape direct d'une fiche publique (consumer anonyme).
 *   2. Scrape via /api/producers/search (carte / listing producteurs).
 *   3. Scrape via la fiche commande consumer authentifié (T-200 r3).
 *   4. Trilatération inverse par requêtes répétées : un attaquant qui appelle
 *      la même route N fois NE PEUT PAS moyenner les positions floutées pour
 *      retrouver la coordonnée exacte. Voir "Garantie de déterminisme"
 *      ci-dessous.
 *
 * Attaques NON couvertes (chantiers à part — voir T-217, T-227, T-236) :
 *   - Ré-identification par croisement de données publiques (nom de la
 *     ferme + commune + photos + GPS arrondi). Mitigation future : grille
 *     uniforme commune-centroïde / floutage > 1 km. T-217 + T-227.
 *   - Énumération massive de la distance ferme→retrait pour de nombreux
 *     codes postaux (trilatération via Haversine côté client). Mitigation
 *     future : rate-limit côté route. T-236.
 *
 * # Précision retenue
 *
 * Arrondi à 2 décimales :
 *   - ~1.1 km en latitude (constant), ~750 m en longitude à 47° (Sarthe).
 *   - Suffisant pour ne pas pinpoint la maison, suffisant pour un widget
 *     distance "à vol d'oiseau" (erreur < 1% à 100 km).
 *   - Marge négligeable face à la référence GMS_DISTANCE_KM_REFERENCE
 *     = 1500 km du score carbone (l'erreur d'arrondi disparaît dans le ratio).
 *
 * # Garantie de déterminisme
 *
 * `Math.round(v * 100) / 100` est strictement déterministe : même entrée →
 * même sortie, sans état, sans alea. C'est ce qui rend la défense robuste
 * face à la trilatération par requêtes répétées : un offset aléatoire
 * trahirait la valeur exacte au bout de N appels (moyenne des bruits → 0).
 *
 * Le helper rejette aussi NaN / Infinity en null pour fail-safe : un producer
 * dont le géocodage a échoué ne se retrouve jamais avec une coordonnée
 * corrompue côté client.
 *
 * # Sites d'appel autorisés
 *
 * Toute fonction qui sérialise lat/lng vers un client DOIT passer par
 * `roundCoord`. Sites actuels (audit r3) :
 *   - `lib/producers/fetch-public.ts` (fiche publique slug + page produit).
 *   - `app/api/producers/search/route.ts` (carte + listing producteurs).
 *   - `app/(consumer)/compte/commandes/[id]/page.tsx` (fiche commande consumer).
 *
 * Toute nouvelle surface qui retourne un producer DOIT être ajoutée à cette
 * liste et appeler ce helper. Cf. test contractuel
 * `tests/app/api/producers/search/route.test.ts` pour la route search.
 */
export function roundCoord(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

# Précision Haversine après arrondi 2 décimales — T-231

> Date : 2026-05-07
> Issue : compromis entre privacy producteur (floutage coordonnées) et précision affichée du widget distance consumer.
> Décision active : arrondi 2 décimales (~1.1 km), conservé tant que T-217 n'a pas tranché un floutage uniforme >= 1 km.

---

## Origine du compromis

Le helper canonique `lib/producers/coords.ts` `roundCoord(v)` arrondit toute coordonnée producteur à 2 décimales avant exposition côté client (consumer public, consumer authentifié, route /api/producers/search). Précision résultante : ~1.1 km en latitude (constant), ~750 m en longitude à 47° (Sarthe).

Voir `lib/producers/coords.ts` (commentaire de tête) pour le modèle de menace adressé : exposer les coordonnées brutes lat/lng (6 décimales = ~10 cm) revient à publier l'adresse personnelle du producteur en élevage fermier où adresse exploitation = domicile dans la majorité des cas.

## Conséquence sur le DistanceWidget

Le DistanceWidget consumer (composant `DistanceWidget.tsx`, route `/api/geocode`) calcule la distance Haversine entre :

- coordonnées CP visiteur (résolues côté serveur via cache `geocode_cache` puis fallback `api-adresse.data.gouv.fr`)
- coordonnées producteur arrondies (2 décimales, post-`roundCoord`)

L'erreur d'arrondi (~1.1 km en lat, ~750 m en lng) se propage dans la valeur Haversine retournée. Pour un producteur à 3 km du visiteur, la valeur affichée peut osciller entre ~2 km et ~4 km selon la position relative du visiteur dans la cellule arrondie.

### Régime selon la distance

| Distance vraie  | Erreur d'arrondi | Erreur relative | Lisibilité widget          |
|-----------------|------------------|-----------------|----------------------------|
| < 5 km          | ±1-2 km          | 20-40%          | Imprécision visible        |
| 5-15 km         | ±1-2 km          | 7-25%           | Imprécision perceptible    |
| 15-50 km        | ±1-2 km          | 2-12%           | Imprécision marginale      |
| > 50 km         | ±1-2 km          | < 4%            | Imperceptible à l'œil      |

Au-delà de 50 km, l'erreur disparaît dans le bruit. Sur la référence GMS_DISTANCE_KM_REFERENCE (1500 km) du score carbone, l'erreur représente moins de 0.1% — totalement négligeable.

## Coût assumé

Le widget peut afficher "4 km" pour un voisin réel à 3 km. C'est un coût accepté du floutage : on préfère un affichage légèrement imprécis sur les courtes distances plutôt qu'exposer l'adresse exacte du producteur (privacy prime sur l'UX).

## Décisions ouvertes (hors scope T-231)

- **T-217** : choisir une stratégie uniforme — maintien arrondi 2 décimales OU bascule sur grille commune-centroïde (~5-10 km, info distance moins parlante mais plus défensive face à la ré-identification croisée).
- **T-227** : étude de la ré-identification par croisement (nom de ferme + commune + photos + GPS arrondi). Décide si l'arrondi 2 décimales reste suffisant en présence d'autres signaux publics.
- **Arrondi serveur plus fin (3 décimales = ~100 m)** : possible compromis intermédiaire qui réduirait l'erreur Haversine à ±100-200 m mais expose la rue précise du producteur. Reste ouvert sous T-217 — verdict actuel : non, ~100 m est suffisant pour pinpoint la maison via Street View ou cadastre IGN, donc régresse sur la privacy.

## Cohérence avec les autres compromis

- **GMS_DISTANCE_SOURCE_LABEL** affiche "à vol d'oiseau" — cohérent avec une métrique Haversine légèrement bruitée (l'utilisateur sait qu'il s'agit d'une approximation).
- Le wording widget actuel ne promet pas une précision GPS routière. Pas de régression UX en augmentant le bruit dans la limite des seuils calculés ci-dessus.

## Références

- Helper canonique : `lib/producers/coords.ts` (`roundCoord`)
- Threat model coords producteur : `docs/security/threat-reidentification-producteur-2026-05-06.md`
- Cache CP côté serveur : `lib/geo/geocode-cache.ts` (T-219, doctrine T-200 r1)
- Décisions ouvertes : T-217 (stratégie uniforme), T-227 (ré-identification croisée)

# Méthodologie distance « à vol d'oiseau » — T-242

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 (score carbone).
> **Statut** : doctrine technique de référence.
> **Audience** : (a) destinée à intégration future page mentions
> légales / FAQ pour transparence consumer ; (b) référence dev pour
> toute future feature géographique TerrOir.
> **Date** : 2026-05-06.

---

## TL;DR

TerrOir affiche la distance **« à vol d'oiseau »** entre la position du
consumer et l'adresse du producteur. La méthode :

- **Formule** : Haversine (grand-cercle).
- **Rayon Terre** : 6371 km (rayon moyen WGS84).
- **Précision affichée** : arrondie à 1 décimale (km).
- **Point producteur** : coords lat/lng floutées à 2 décimales (~1 km
  de précision), cf. `lib/producers/coords.ts`.
- **Point consumer** : soit géoloc navigateur (précision OS, ~10 m
  pour GPS, ~100 m pour wifi/IP), soit centre INSEE de la commune
  associée au CP saisi (précision géocodeur public
  `api-adresse.data.gouv.fr`).
- **Erreur attendue** : ±1 à 2 km (combinaison floutage producteur +
  arrondi décimal). Négligeable face à la référence circuit long
  (~1500 km, ADEME).
- **Seuil hors zone** : au-delà de 500 km, la distance brute n'est
  plus affichée (cf. `DISTANCE_OUT_OF_REACH_KM`).

---

## Formule mathématique

### Définition Haversine
Pour deux points P1 = (φ₁, λ₁) et P2 = (φ₂, λ₂) en latitude / longitude :

```
a = sin²(Δφ/2) + cos(φ₁) · cos(φ₂) · sin²(Δλ/2)
c = 2 · atan2(√a, √(1-a))
d = R · c
```

où :
- Δφ = φ₂ - φ₁ (différence latitude, en radians),
- Δλ = λ₂ - λ₁ (différence longitude, en radians),
- R = 6371 km (rayon Terre moyen WGS84),
- d = distance grand-cercle en km.

### Hypothèses du modèle
- **Terre sphérique** (rayon constant 6371 km). En réalité, la Terre
  est un ellipsoïde aplati aux pôles (rayon équatorial ~6378 km, rayon
  polaire ~6357 km). Pour la France métropolitaine (~46° N), l'erreur
  d'approximation sphérique est < 0.5 % sur des distances de
  10-1000 km. Acceptable pour notre usage.
- **Pas de prise en compte du relief** : un trajet routier réel est
  plus long que la distance "à vol d'oiseau" (typique : 1.2× à 1.5×
  selon densité routes). Notre choix produit est de communiquer la
  distance "à vol d'oiseau" car :
  - elle ne dépend pas de l'algo de routing (aller/retour, itinéraire
    optimisé, voie rapide vs secondaire) → reproductible.
  - elle reste indépendante de l'infrastructure (résiste à un fournisseur
    de routing changeant ses heuristiques).
  - elle est facilement re-calculable par le consumer si besoin de
    contre-vérifier.

### Implémentation TerrOir
Source : `lib/geo/haversine.ts`. Code conforme à la formule ci-dessus,
avec arrondi final `Math.round(km * 10) / 10` (1 décimale, soit 100 m
de granularité d'affichage).

---

## Précision attendue

### Sources d'erreur

#### 1. Floutage des coords producteur (~1 km)
Source : `lib/producers/coords.ts` :: `roundCoord` arrondit lat/lng à
2 décimales avant exposition côté consumer.

| Décimales | Précision lat | Précision lng à 47° N |
|-----------|---------------|------------------------|
| 6 | ~10 cm | ~7 cm |
| 4 | ~11 m | ~7 m |
| 3 | ~110 m | ~75 m |
| **2** | **~1.1 km** | **~750 m** |
| 1 | ~11 km | ~7.5 km |

Ce floutage est volontaire (anti-ré-identification adresse personnelle
du producteur fermier — cf. T-200 r2 + T-217). Il introduit une erreur
maximale de ~1.3 km sur la distance affichée.

#### 2. Précision du point consumer
**Géoloc navigateur** : précision dépend de l'OS et du contexte :
- GPS pur (smartphone outdoor) : ~10 m.
- Wifi/triangulation : ~50-200 m.
- IP geoloc (fallback) : ~5-20 km (très grossier).

**Centre commune INSEE (saisie CP)** : le géocodeur
`api-adresse.data.gouv.fr` retourne le point géographique du centre de
la commune principale associée au CP. Précision dépend de la taille de
la commune (centre vs. périphérie). En Sarthe, communes typiques 5-20
km² → erreur ~1 à 4 km.

#### 3. Approximation sphérique vs ellipsoïdale
< 0.5 % sur la distance, négligeable.

#### 4. Arrondi 1 décimale du résultat
±50 m. Négligeable.

### Erreur cumulée typique
**Pour un consumer urbain saisissant son CP** :
- Floutage producteur : ±1.3 km.
- Centre commune INSEE consumer : ±2 à 4 km.
- → **Erreur cumulée** : ~3-5 km.

Pour un consumer **proche** du producteur (5-20 km de distance vraie),
l'erreur représente 15-50 % de la distance affichée. Limitation
assumée : on préfère afficher "8 km" pour un voisin réel à 5 km plutôt
qu'exposer l'adresse exacte du producteur.

Pour un consumer **distant** (>50 km), l'erreur devient indétectable à
l'œil (relative <10 %).

### Communication consumer
Le wording in-situ DistanceWidget mentionne explicitement « à vol
d'oiseau » dans :
- Label compact : `${distance} km à vol d'oiseau`.
- Phrase contextuelle : `à vol d'oiseau jusqu'à toi depuis {producer}`.
- Eyebrow : `Toi ↔ ferme`.

Le terme "à vol d'oiseau" est compris du grand public (différencie de
"distance routière"). Pas de mention de l'arrondi ni du floutage côté UI
— transparence détaillée à reporter sur la page FAQ / mentions légales
(cf. § Intégration future).

---

## Choix de point géographique

### Côté producteur
**Source** : `producers.latitude` + `producers.longitude` (coords
géocodées au moment de l'onboarding, depuis l'adresse postale saisie
par le producer en `StepInfos`).

**Floutage avant exposition** : systématique via `roundCoord` (cf.
`docs/security/audit-champs-sensibles-fiche-publique-2026-05-06.md`
T-254 § B + § coords floutage). Helper canonique : sites d'appel
auditables :
- `lib/producers/fetch-public.ts` (fiche publique slug).
- `app/api/producers/search/route.ts` (carte + listing).
- `app/(consumer)/compte/commandes/[id]/page.tsx` (fiche commande
  consumer).

### Côté consumer
2 voies de saisie possibles via `DistanceWidget` :

**Voie A — Géoloc navigateur**.
- API : `navigator.geolocation.getCurrentPosition`.
- Consentement double : clic CTA "Utiliser ma position" + prompt browser.
- Précision : variable selon OS (cf. § Précision).
- Stockage : sessionStorage `terroir_geo_session = { lat, lng,
  source: "geoloc" }` — purge fermeture onglet.

**Voie B — Saisie CP**.
- Validation : regex `^\d{5}$` côté UI + côté serveur (Zod).
- Résolution : `GET /api/geocode?cp=XXXXX` → cache Supabase `geocode_
  cache` (T-219) → fallback `api-adresse.data.gouv.fr`.
- Le résultat de la résolution est le **centre INSEE de la commune
  principale associée au CP**.
- Stockage : sessionStorage `terroir_geo_session = { lat, lng,
  source: "postal" }`.

### Articulation T-217 (politique uniforme floutage)
T-217 a tranché : maintien de l'arrondi 2 décimales pour les coords
producteur. Pas de bascule vers une grille commune-centroïde (qui
écraserait toute la précision intra-commune et changerait la sémantique
"distance jusqu'à la ferme").

### Articulation T-219 (cache CP→coords)
T-219 a livré le cache serveur Supabase `geocode_cache` (donnée publique
INSEE, pas PII, hit_count agrégé anonyme). Le cache amortit les appels
au géocodeur public, mais la résolution reste la même (centre commune).

---

## Référentiel comparatif circuit long

### Constante affichée
```ts
GMS_DISTANCE_KM_REFERENCE = 1500 km
```
Source : ADEME — distance moyenne parcourue par un produit alimentaire
en circuit long (importation, centrale d'achat, entrepôts régionaux,
GMS finale). Cette constante est documentée dans
`lib/producers/score-carbone-enums.ts` avec la mention source ADEME
(`GMS_DISTANCE_SOURCE_LABEL`).

### Garde-fou hors zone
```ts
DISTANCE_OUT_OF_REACH_KM = 500 km
```
Source : `lib/geo/haversine.ts:16`. Au-delà, le DistanceWidget bascule
sur le message "Hors zone circuit court" (ne montre plus la distance
brute ni la barre comparative). Cas typique : visiteur DOM-TOM
saisissant son CP outre-mer sur la fiche d'un producteur métropolitain.

### Articulation T-206 (revue avocat formulation comparative)
La formulation comparative "~1500 km" est en attente de revue avocat
(loi Climat & Résilience). Indépendant du choix Haversine — le calcul
reste valide quel que soit le wording final.

---

## Cas particuliers

### Producteur sans coords lat/lng
Si `producers.latitude` ou `producers.longitude` est NULL :
- DistanceWidget retourne `null` (early return ligne 168) : le widget
  ne s'affiche pas du tout sur la fiche.
- Cf. T-202 (backfill lat/lng des 5 producteurs sans coords) — bloquant
  Live UX critique.

### Consumer hors France (saisie CP étranger)
La regex `^\d{5}$` côté UI accepte n'importe quel format 5-chiffres,
mais le géocodeur `api-adresse.data.gouv.fr` ne couvre que la France.
Pour un CP étranger (ex. Belgique 1000, Suisse 1200) :
- L'API retourne `not_found` → message d'erreur in-situ "Code postal
  introuvable".
- Pas de leak géo (aucune résolution effectuée).

→ Backlog T-216 (i18n géocodeur hors France) couvrira ce cas en
scaling.

### Position consumer à l'étranger (géoloc native)
Si la géoloc navigateur retourne des coords hors France
(visiteur en voyage, frontalier), le calcul Haversine reste valide
(formule indépendante du pays). Le seuil 500 km bascule vers "Hors
zone" pour la plupart des cas frontaliers européens.

---

## Intégration future page mentions légales / FAQ

### Wording grand public proposé (section FAQ)
> **Comment TerrOir calcule la distance entre toi et le producteur ?**
>
> Nous utilisons la formule mathématique de Haversine, qui calcule la
> distance "à vol d'oiseau" entre deux points sur la Terre. Cette
> méthode donne la distance la plus courte théorique entre toi et la
> ferme, indépendamment du trajet routier réel.
>
> Pour préserver la vie privée du producteur, nous arrondissons sa
> position à environ 1 km près. Ta propre position vient soit de la
> géolocalisation de ton navigateur, soit du centre de la commune
> associée à ton code postal (centre commune INSEE).
>
> En conséquence, la distance affichée a une marge d'erreur typique
> de quelques kilomètres. Ce n'est pas la distance routière exacte —
> Google Maps te donnera ce chiffre si tu cherches l'itinéraire
> précis pour aller chercher ta commande.

### Précisions juridiques (mentions légales)
> **Méthode de calcul de la distance**
>
> Distance à vol d'oiseau, formule Haversine, rayon Terre 6371 km
> (modèle sphérique WGS84). Le point géographique du producteur est
> sa position arrondie à 0.01° (~1 km). Le point géographique de
> l'utilisateur est soit sa géolocalisation navigateur, soit le centre
> INSEE de la commune associée au code postal saisi (résolu via le
> service public api-adresse.data.gouv.fr). La distance n'est pas
> contractuelle — elle est fournie à titre indicatif pour aider la
> décision d'achat dans une logique de circuit court.

→ À reprendre lors de la livraison de `/politique-confidentialite`
(T-207) + `/mentions-legales` (T-041).

---

## Cross-références

- `lib/geo/haversine.ts` — implémentation.
- `lib/producers/coords.ts` — helper `roundCoord` + modèle de menace
  floutage.
- `lib/geo/geocode-cache.ts` — cache CP→coords (T-219).
- `lib/geo/geocode-postal.ts` — résolution `api-adresse.data.gouv.fr`.
- `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx` —
  composant UI.
- `lib/producers/score-carbone-enums.ts` — constante
  `GMS_DISTANCE_KM_REFERENCE` + sourcing ADEME.
- `docs/security/audit-champs-sensibles-fiche-publique-2026-05-06.md`
  (T-254) — détail floutage par call site.
- **Tasks liées** :
  - T-217 (politique uniforme floutage coords).
  - T-219 (cache CP→coords).
  - T-202 (backfill lat/lng producteurs).
  - T-206 (revue avocat formulation comparative).
  - T-216 (i18n géocodeur hors France — scaling).
  - T-207 (politique conf — intégration future).
  - T-041 (mentions légales — intégration future).

### Standards externes
- [Haversine formula — Wikipedia](https://en.wikipedia.org/wiki/Haversine_formula).
- [WGS84 — World Geodetic System 1984](https://en.wikipedia.org/wiki/World_Geodetic_System).
- [api-adresse.data.gouv.fr — Documentation BAN](https://adresse.data.gouv.fr/api-doc/adresse).

---

## Maintenance de cette doctrine

- Toute modification de la formule (ex. bascule vers Vincenty
  ellipsoïdal) requiert validation Romain + mise à jour synchrone du
  wording UX et de la documentation FAQ / mentions légales.
- Tout changement du floutage producteur (T-217) requiert mise à jour
  synchrone du § Précision attendue + page FAQ.
- Toute extension géographique (T-216) requiert mise à jour § Cas
  particuliers / consumer hors France.

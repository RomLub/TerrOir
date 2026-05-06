# Threat model — ré-identification adresse producteur par croisement de données publiques — T-227

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Statut** : analyse de menace résiduelle, mitigations à acter en
> bundle pré-Live (UX + CGU + politique conf).
> **Audience** : Romain (arbitrages produit / juridique), juriste avocat
> (CGU), futur DPO.
> **Date** : 2026-05-06.

---

## TL;DR

**Menace résiduelle identifiée, niveau modéré, mitigations principales
non-techniques.**

Le floutage des coordonnées producteur à 2 décimales (~1 km, T-217 +
T-218-bis) couvre l'attaque "scrape coords brutes" mais ne suffit pas
seul : un attaquant peut **croiser** plusieurs signaux publics
volontairement publiés (`nom_exploitation` + `commune` + `code_postal`
+ `photos` + `adresse postale` sur fiche produit) pour ré-identifier
avec un effort modéré l'adresse exacte du producteur — souvent =
domicile pour fermiers.

**Niveau de risque résiduel** : modéré (vecteur d'attaque accessible
mais coûteux en temps).

**Mitigations existantes** : floutage coords (T-217 + T-218-bis),
trigger anti-self-update lat/lng (T-218 + T-218-bis), rate-limit search
(T-236).

**Mitigations à acter** :
- **M1 — UX onboarding** : avertir le producteur de la publication
  publique de son adresse au moment de la saisie `StepInfos`.
- **M2 — CGU producteur** : clause explicite de publication de
  l'adresse postale + recommandation "adresse de la ferme, pas du
  domicile personnel".
- **M3 — Politique de confidentialité** : section dédiée "données
  producteur publiées" listant explicitement les champs publics.
- **M4 — Backlog scaling** : ré-évaluer la stratégie de floutage si
  signal de mauvaise pratique observé (ex. plaintes producteurs,
  scraping massif détecté).

→ Aucune mitigation **technique** supplémentaire bloquante pré-Live.
La menace est consciente et acceptée comme **inhérente au modèle
marketplace short-circuit** (le consumer doit pouvoir venir retirer
sa commande, donc l'adresse de retrait est par construction publique).

---

## Vecteur d'attaque détaillé

### Profil attaquant
- **Capacité** : non-technique à technique modéré (humain motivé +
  outils standard cartographie / géo-OSINT).
- **Motivation** : harcèlement / stalking d'un producteur identifié,
  collecte d'infos pour vente forcée, journalisme intrusif, doxxing.
- **Effort** : 30 min à 2-3 heures par cible selon densité d'infos
  publiques disponibles.

### Données publiques disponibles sur TerrOir

#### Champs textuels (cf. T-254 audit fiche publique)
- `nom_exploitation` (ex. "GAEC du Rheu", "Ferme du Petit Bois").
- `commune` + `code_postal` (granularité département + village).
- `adresse` postale (sur fiche produit + fiche commande consumer
  authentifié).
- `description`, `histoire` (texte libre saisi par le producer,
  contient parfois des indices géographiques précis : "à 5 km du
  bourg", "à côté du moulin", "lieu-dit ...").
- `annee_creation`, `generations`, `especes`, `labels`, `mode_elevage`.

#### Visuels
- `photo_principale` + `photos` (jusqu'à ~6 sur fiche slug, plus sur
  fiche produit).
- Les photos extérieures du bâtiment / paysage permettent
  l'identification visuelle si croisées avec Street View / Google
  Maps satellite.

#### Coordonnées géographiques
- `latitude` + `longitude` floutées à 2 décimales (~1 km).

### Étapes du croisement attaquant (scénario réaliste)

#### Étape 1 — Cibler un producer
L'attaquant identifie un producer cible via la fiche publique
`/producteurs/<slug>`.

#### Étape 2 — Restreindre le champ géographique
Coords floutées 2 décimales = zone carrée d'environ 1 km × 0.75 km
(à 47° N) = ~0.75 km². Soit typiquement **1 à 5 hameaux / lieux-dits
candidats** dans une commune sarthoise.

#### Étape 3 — Croiser avec photos satellite + Street View
Pour chaque candidat dans la zone floutée :
- Vérifier la présence de bâtiments correspondant aux photos publiques
  (forme du toit, alignement, environnement boisé / champ).
- Cherche correspondance précise via Google Maps satellite.
- Confirme par Street View si la rue est covered.

→ Réduit typiquement à **1-2 candidats** en 30 min de travail manuel.

#### Étape 4 — Vérifier via base SIRENE / annuaire
Le `nom_exploitation` + `commune` permet souvent de retrouver le siège
social via [INSEE SIRENE base ouverte](https://www.sirene.fr/sirene/
public/recherche) ou
[Pages Jaunes](https://www.pagesjaunes.fr/) — qui peuvent retourner
l'adresse exacte (siège ≠ domicile parfois, mais souvent = domicile
en élevage fermier).

→ Confirmation finale possible **sans effort technique**, juste base
publique gratuite.

### Cas particulier — Adresse postale exposée fiche produit (T-254 § A1)
**Si le producer a saisi son adresse domicile en `producers.adresse`**
(cas observable en élevage fermier), l'étape 1 → étape 4 devient
inutile : l'adresse exacte est exposée directement sur la fiche produit
(visible publiquement, lecture sans authentification).

→ **Vecteur principal de fuite**. Mitigation = M1 + M2 (UX onboarding
+ CGU).

---

## Niveau de risque résiduel

### Évaluation
| Critère | Niveau |
|---|---|
| **Exposition** | Modérée (fiche publique accessible sans login). |
| **Effort attaquant** | Modéré (30 min à 2-3 h selon cas). |
| **Outils requis** | Standard (browser + Google Maps + INSEE SIRENE). |
| **Identifiabilité finale** | Forte (1-2 candidats restants après croisement). |
| **Surface d'attaque** | Toute fiche producer publique. |

### Niveau global : **modéré**
Pas une attaque triviale (pas accessible à un script automatisé
naïf) mais accessible à un humain motivé.

### Comparaison à des risques équivalents secteur
- **Autres marketplaces short-circuit** (La Ruche Qui Dit Oui, BienVu,
  Ouicommerce, etc.) : pratique identique d'exposer l'adresse retrait.
  Pas de standard sectoriel plus protecteur.
- **Annuaires producteurs locaux** (Bienvenue à la ferme, Mangeons
  local) : exposent souvent plus de détails (numéro de tel, etc.).
- **Sites administratifs** (chambres d'agriculture) : exposent siège
  social via SIRENE.

→ TerrOir n'aggrave pas significativement le risque pré-existant. Le
modèle marketplace short-circuit a cette menace inhérente.

---

## Mitigations existantes (rappel)

### Techniques

#### T-217 — Floutage coords 2 décimales
Helper canonique `lib/producers/coords.ts` :: `roundCoord` arrondit à
~1 km. Couvre l'attaque "scrape coords brutes" (sans croisement).

#### T-218 + T-218-bis — Trigger anti-self-update lat/lng
`producers_block_owner_admin_columns` empêche un producer de se ré-écrire
des coords précises via PostgREST (defense in depth contre un dev
qui aurait oublié de filtrer côté serveur).

#### T-236 — Rate-limit `/api/producers/search`
30 req/min/IP. Empêche l'énumération brute massive (ex. balayage
exhaustif de tous les CPs Sarthe pour ré-identifier par trilatération
inverse).

#### T-200 r1 — Doctrine privacy serveur
Aucun log per-user des CPs / coords (T-249) → un acteur interne abusif
n'a pas accès à un historique géo des consumers.

### Non-techniques (à acter)

#### M1 — UX onboarding
**À acter** dans le composant `StepInfos` (formulaire onboarding
producer) : avertissement court sous le champ `adresse` :

> ⚠️ Cette adresse sera publiée sur tes fiches produit. Préfère
> l'adresse de ta ferme ou un point de retrait dédié, plutôt que ton
> domicile personnel si l'exploitation est attenante à ta maison.

→ Recommandation T-254 R1 / T-227 M1.

#### M2 — CGU producteur
**À acter** dans la rédaction CGU :

> Clause § Publication de l'adresse :
> Le producteur reconnaît que son adresse postale (champ adresse +
> code postal + commune) sera publiée sur les fiches produit
> consultables par tout visiteur de la plateforme. Cette publication
> est nécessaire au fonctionnement de la marketplace short-circuit
> (le consumer doit savoir où venir retirer sa commande). Le
> producteur s'engage à n'inscrire dans ce champ qu'une adresse
> qu'il accepte de rendre publique.

→ Recommandation cluster T-209 + T-262 + T-227 M2.

#### M3 — Politique de confidentialité globale
**À acter** dans `/politique-confidentialite` (T-207) section
"données producteur publiées" :

> Les données suivantes du compte producteur sont publiées sans
> restriction sur la plateforme : nom de l'exploitation, commune,
> code postal, adresse postale, photos, description, histoire,
> labels, espèces, indicateurs score carbone (mode élevage,
> alimentation, densité animale).

→ Recommandation T-207 + T-227 M3.

#### M4 — Backlog scaling (post-Live)
**À ré-évaluer** si :
- Plainte producer remontée (« on m'a retrouvé via la fiche »).
- Scraping massif détecté (rate-limit déclenché à fréquence anormale).
- Audience scale au-delà de la Sarthe (densité moindre = ré-identification
  plus facile par déduction).

Options de durcissement futures :
- Floutage à 1 décimale (~11 km) — perd l'argument distance widget.
- Bascule vers grille commune-centroïde uniforme (pas de coords brutes
  affichées du tout).
- Toggle "publier mon adresse exacte" dans l'onboarding (soft
  pseudonymisation en faveur d'un point retrait neutralisé).

---

## Articulation backlog T-203

T-203 (backlog) : "Pré-remplissage global position consumer (header /
compte) — articulation T-213". Pas directement lié à T-227 (qui couvre
le côté **producteur**, pas consumer), mais cohérent :
- Si TerrOir publie un jour un référentiel "producers proches de
  toi" sur la page d'accueil, vérifier que le calcul s'appuie sur les
  coords floutées et n'expose pas l'adresse précise.

---

## Recommandations prioritaires

### R1. Acter le bundle M1 + M2 + M3 en pré-Live
**Priorité** : haute (clôt le risque résiduel pré-launch).

Bundle minimal :
- M1 (UX onboarding `StepInfos`) — issue ux-engineer (composant).
- M2 (CGU producteur) — issue juridique avocat (T-209 + T-262).
- M3 (politique conf section) — issue rédaction (T-207).

Permet de cocher T-227 dans la checklist pré-Live (cluster RGPD T-261).

### R2. Documentation backlog "veille re-ID"
**Priorité** : moyenne (post-Live).

Inscrire dans le backlog (post-Live) :
- Surveiller les tickets support producer mentionnant ré-identification.
- Surveiller les triggers rate-limit `/api/producers/search` à
  fréquence anormale.
- Réévaluer la stratégie de floutage si signal détecté.

### R3. Considérer toggle "adresse exacte vs commune" à l'onboarding
**Priorité** : faible (chantier produit dédié post-Live).

Permettre au producer de choisir entre :
- (a) Publier l'adresse exacte de la ferme (cas marché paysan, ferme
  visible depuis route principale, point retrait connu).
- (b) Publier seulement la commune + un texte libre "à 2 km du bourg
  vers Le Mans" (cas domicile personnel, producer souhaitant plus de
  réserve).

→ Coûteux à designer, à arbitrer si signal faible/moyen détecté
post-Live.

---

## Cross-références

- `docs/security/audit-champs-sensibles-fiche-publique-2026-05-06.md`
  (T-254) — confirme l'exposition `producers.adresse` sur fiche produit
  + fiche commande.
- `docs/security/registre-traitements-widget-distance-2026-05-06.md`
  (T-208) — registre RGPD widget distance (pas le même traitement, mais
  cluster commun).
- `lib/producers/coords.ts` — modèle de menace floutage + tableau de
  précisions par décimale.
- `app/(producer)/invitation/_components/StepInfos.tsx` — composant
  cible recommandation M1.
- **Tasks liées** :
  - T-217 (politique uniforme floutage) — déjà tranché 2 décimales.
  - T-218 + T-218-bis (trigger anti-self-update lat/lng) — livré.
  - T-236 (rate-limit search) — livré.
  - T-254 (audit champs sensibles fiche publique) — couvert ce cycle.
  - T-209 (CGU producteur — base légale clause publication).
  - T-207 (politique conf — section dédiée).
  - T-262 (CGU/CGV pré-Live — articulation).
  - T-203 (backlog pré-remplissage position consumer — vigilance
    transverse).

### Standards externes
- [INSEE SIRENE base ouverte](https://www.sirene.fr/) — source publique
  utilisable par attaquant pour ré-identification.
- [CNIL — Pseudonymisation et anonymisation](https://www.cnil.fr/fr/
  comprendre-les-grands-principes-de-la-cryptologie-et-du-chiffrement)
  — référentiel CNIL sur les techniques.

---

## Conclusion

T-227 ✅ — la menace de ré-identification adresse producteur par
croisement de données publiques est identifiée et caractérisée
(niveau modéré). Les mitigations techniques existantes (T-217 + T-218-bis
+ T-236) couvrent les scénarios automatisés. Les mitigations
non-techniques (M1 UX + M2 CGU + M3 politique conf) restent à acter en
bundle pré-Live pour clore le risque résiduel humain. La menace est
consciente, acceptée comme inhérente au modèle marketplace short-circuit,
et alignée avec les pratiques sectorielles équivalentes.

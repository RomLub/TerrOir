# Threat model — ré-identification adresse producteur par croisement de données publiques (T-227)

> Audit pur (lecture seule, aucun code modifié). Session 2026-05-06.
>
> Articulation : **T-217** (politique uniforme floutage à arbitrer), **T-235** (defense in depth DB-level vue `producers_public`, backlog), **T-238** (defense in depth code-level scan no raw coords leak, livré 2026-05-06), **T-003** (audit pré-Live transverse — validation juridique CGU), **T-211** (déclinaison par métier).
>
> Ce document complète les défenses techniques posées par T-238 + T-235 (futur) en explicitant le **risque résiduel** : un attaquant peut ré-identifier l'adresse précise d'un producteur via le croisement de données publiques externes, malgré le floutage des coords à 2 décimales.

---

## Contexte — ce que protège l'arrondi `roundCoord`

Le helper `lib/producers/coords.ts` (T-200 r2 / T-231) arrondit toute lat/lng producteur à **2 décimales** avant exposition côté client (consumer, fiche publique). Précision résultante (cf. tableau dans le helper) :

- ~1.1 km en latitude (constant),
- ~750 m en longitude à 47° (Sarthe) → la zone exposée est un **rectangle ~1.1 km × ~750 m ≈ 0.83 km²**.

Ce floutage **élimine** :
- Le pinpoint adresse au mètre près via une seule fiche publique.
- La trilatération inverse par requêtes répétées (le helper est strictement déterministe — l'attaquant qui appelle N fois la même route récupère N fois la même valeur arrondie, pas un offset aléatoire moyennable).

Ce floutage **NE protège pas** contre l'attaque qui suit.

---

## Modèle de menace — l'attaque par croisement

### Hypothèse de l'attaquant

Un attaquant motivé qui veut retrouver l'adresse précise d'un producteur TerrOir donné. Motivations typiques :
- Concurrent qui veut prospecter / approcher en physique le producteur.
- Journaliste / chercheur qui veut visiter sans appel préalable.
- Cas malveillants : harcèlement, vol bétail, intrusion, etc.

L'attaquant a accès à :
- La **fiche publique TerrOir** du producteur (nom de l'exploitation, commune, code postal, photos, description, score carbone).
- L'**API search public** TerrOir (`/api/producers/search`), avec coords floutées à 2 décimales (~1 km².
- Les **sources publiques externes** : Google Maps, OpenStreetMap, BAN, INSEE SIRENE, INPI / Infogreffe, Pages Jaunes, presse régionale, réseaux sociaux producteur (Facebook page ferme, Instagram).

### Vecteurs disponibles

| # | Vecteur | Donnée fuite | Difficulté attaque | Pire cas |
|---|---|---|---|---|
| V1 | Nom de l'exploitation unique géographiquement | Adresse via Google search | Triviale | Adresse précise en 1 requête Google. |
| V2 | Nom du producteur (`prenom` exposé public, `nom` parfois en `nom_exploitation`) | Adresse via Pages Jaunes / Infogreffe / SIRENE | Faible | Adresse précise en quelques minutes via base SIRENE (gratuite, ouverte). |
| V3 | Commune + code postal | Restreint zone à ~5-50 km² | Triviale | Combiné avec un autre vecteur (V1, V4, V5), réduit drastiquement l'espace de recherche. |
| V4 | Photos publiques façade ferme / panneau signalétique / vue paysage reconnaissable | Adresse via image inversée Google Lens / photo géolocalisable | Faible-moyenne | Plaque immatriculation véhicule visible, panneau signalétique de la ferme, façade au profil unique → recherche image inversée trouve un blog / site presse régional avec adresse. |
| V5 | Description / score carbone mentionnant un point d'intérêt local nominatif (« à proximité de [lieu-dit] », « voisin de [exploitation X] ») | Restreint zone à <1 km² | Faible | Combiné avec coords floutées, retrouve l'adresse précise par recherche cartographique manuelle. |
| V6 | Coordonnées floutées à 2 décimales (~1 km² rectangle) | Zone de ~1 km² centrée sur l'adresse | Aucune (donnée déjà publique) | Sert de **point de départ** pour les autres vecteurs : narrow down la recherche manuelle. |
| V7 | Combinaison V1 + V6 OR V2 + V6 | Adresse précise | Triviale-faible | Recherche Google « [nom ferme] [commune] » + coords arrondies confirme l'adresse retrouvée. |

### Pire cas documenté

> Producteur avec un nom d'exploitation unique (V1) + photos façade reconnaissable (V4) + commune (V3) + coords floutées (V6) → ré-identification adresse précise en **moins de 5 minutes** par un attaquant motivé sans compétence technique avancée.

C'est le cas typique pour les **élevages fermiers traditionnels** : nom de la ferme = nom de famille du producteur (« Ferme Dupont », « GAEC Martin ») + photos avec façade exploitation reconnaissable + commune mentionnée → recherche cadastre / annuaire pages jaunes trouve l'adresse en quelques requêtes.

### Cas atténué

Producteur dont :
- nom d'exploitation est une marque commerciale générique (« Le Verger » plutôt que « Verger Dupont »),
- aucune photo de façade ou paysage spécifique,
- commune non mentionnée explicitement (rester sur le code postal seul, qui couvre plusieurs communes),
- description neutre sans points d'intérêt locaux nominatifs,
→ ré-identification reste possible mais demande effort sérieux (pas juste 5 minutes Google).

C'est rare en pratique : l'écosystème producteur fermier utilise massivement le nom de famille comme marque commerciale.

---

## Recommandations privacy — 3 niveaux

### Niveau 1 — Technique (déjà en place)

| Mitigation | Statut | Couvre |
|---|---|---|
| `roundCoord` à 2 décimales avant exposition | ✅ T-200 r2 / T-231 | V6 (coords brutes au mètre) |
| Scan meta no raw coords leak (`tests/meta/no-raw-coords-leak.test.ts`) | ✅ T-238 | Régression code-level (nouvelle route exposant des coords brutes par mégarde) |
| Vue Postgres `producers_public` defense in depth DB-level | ⏳ T-235 backlog | Régression DB-level (un nouveau SELECT côté admin/script qui exposerait la colonne native) |
| Trigger admin-only `lat/lng` (T-218-bis) | ✅ T-218-bis | Modification de coords par owner (préserve la valeur posée par admin/géocodage) |
| Rate-limit `/api/producers/search` 30/min/IP | ✅ T-236 | Énumération massive coords pour trilatération inverse (non applicable depuis T-231 strictement déterministe, mais cap reste pertinent contre l'énumération générale) |

**Pas de niveau technique supplémentaire à proposer T-227.** Les défenses en place couvrent les vecteurs DB et code. La ré-identification par croisement externe est **hors de la portée d'une défense purement technique** côté TerrOir — elle exploite des données que TerrOir ne contrôle pas (Google, SIRENE, etc.).

### Niveau 2 — UX onboarding (à intégrer côté produit)

À cadrer avec **T-211** (déclinaison par métier) et **T-217** (politique uniforme floutage).

| Mitigation | Effort | Bénéfice | À cadrer |
|---|---|---|---|
| **Tooltip / page d'aide « Bonnes pratiques privacy »** dans l'onboarding producteur, qui liste les vecteurs V1 → V5 et explique au producteur **comment limiter l'exposition** : ne pas publier de photo façade ou panneau signalétique reconnaissable, éviter les points d'intérêt nominatifs dans la description, accepter le compromis si nom de ferme unique. | ~1 jour onboarding | Réduit la surface V4 + V5 | À écrire avec un copywriter pour rester pédagogique sans alarmer. |
| **Alerte temps réel** (à la saisie d'une description ou upload photo) si un mot-clé sensible est détecté (« lieu-dit », « voisin », « à côté de », nom d'un point d'intérêt local). | ~3 jours | Réduit V5 actif | Détection floue, faux positifs gérables. |
| **Option de floutage > 1 km** (1 décimale = ~11 km, ou commune-centroïde uniforme) pour producteurs qui le demandent. | T-217 backlog | Réduit V6 (de ~1 km² à ~120 km²) | Au prix d'une distance moins parlante côté DistanceWidget consumer. À arbitrer T-217. |
| **Décision sur quoi exposer dans `slug` public** : si le slug = nom du producteur (« ferme-dupont »), V1 trivialement exploitable. Si slug = identifiant aléatoire (`ferme-a3z9`), V1 plus dur. | T-217 + T-211 | Réduit V1 | Trade-off SEO (référencement nom = avantage, anonymisation = perte) à arbitrer. |

### Niveau 3 — Juridique (CGU + politique de confidentialité)

À intégrer dans le cadre de **T-003** (audit pré-Live transverse) avec le juriste référent.

| Élément | Justification |
|---|---|
| **Clause CGU producteur** : information loyale sur le **niveau de protection effectif** des coordonnées personnelles. Le producteur doit savoir, au moment de l'onboarding, que TerrOir floute son adresse mais ne peut pas garantir l'anonymat absolu face à un croisement de données publiques (V1-V5). Doit signer en connaissance de cause. | RGPD art. 13 (information de la personne au moment de la collecte). Loi Climat & Résilience pour le volet allégations environnementales (séparé). |
| **Mention dans la politique de confidentialité TerrOir** (T-041 / T-207) : description des vecteurs résiduels, des mitigations en place, et des recommandations pratiques au producteur (cohérent avec niveau 2 UX onboarding). | Cohérence avec l'engagement loyal d'information. |
| **Procédure de retrait expéditive** : un producteur qui se sentirait exposé doit pouvoir demander à TerrOir le **flou renforcé** ou la **suppression de sa fiche publique** dans un délai court (24-48h). | Droit d'opposition RGPD art. 21. |
| **Audit DGCCRF / CNIL ready** : la documentation T-227 (ce doc) doit être présentable en cas de contrôle, montrant que TerrOir a identifié le risque résiduel et mis en place des mitigations proportionnées. | Conformité RGPD art. 32 (sécurité du traitement) + privacy by design. |

---

## Articulation autres chantiers

- **T-217** (backlog) — politique uniforme de floutage à arbitrer (2 décimales actuel vs 1 décimale uniforme vs commune-centroïde). T-227 informe la décision : la sortie de cette analyse doit être un input direct pour T-217.
- **T-235** (backlog) — vue Postgres `producers_public` defense in depth DB-level. Complémentaire à T-238 code-level. Ne change pas le risque de croisement externe (V1-V5) mais durcit la surface V6 contre les régressions DB.
- **T-238** (livré 2026-05-06) — scan meta no raw coords leak côté code. Couvre uniquement le risque de régression code (un dev qui ajoute une route exposant des coords brutes par mégarde). Ne couvre pas V1-V5.
- **T-003** (backlog) — audit pré-Live transverse, qui doit valider les recommandations niveau 3 (juridique CGU + politique de confidentialité) avec un juriste.
- **T-211** (backlog) — déclinaison des indicateurs et recommandations privacy par métier (élevage vs maraîchage vs boulangerie vs apiculture). L'éleveur isolé en plein champ a une exposition différente du boulanger en cœur de bourg.
- **T-227** (cette doc).

---

## Verdict

Le risque de ré-identification d'adresse producteur par croisement de données publiques externes est **réel et non couvrable techniquement** côté TerrOir. Les défenses techniques en place (T-200 r2 / T-218-bis / T-238) couvrent les vecteurs internes ; les vecteurs externes V1-V5 demandent des mitigations **UX + juridiques**.

Statut : **risque résiduel accepté** sous condition d'activer les niveaux 2 (UX onboarding) et 3 (juridique CGU + politique de confidentialité) avant ouverture publique. Sans ces deux niveaux, l'engagement TerrOir vis-à-vis du producteur reste partiel.

**Bloqueur ouverture publique** : niveau 3 (juridique). Niveau 2 (UX onboarding) : recommandé fortement, pas absolument bloquant si niveau 3 acté avec consentement éclairé du producteur à la signature CGU.

---

## Liens

- `lib/producers/coords.ts` — helper `roundCoord` § « Modèle de menace ».
- `tests/meta/no-raw-coords-leak.test.ts` — scan defense in depth code-level (T-238).
- `docs/TODO.md` — entrées T-217, T-235, T-238, T-003, T-211.
- DGCCRF — [Direction générale de la concurrence, de la consommation et de la répression des fraudes](https://www.economie.gouv.fr/dgccrf).
- CNIL — [Privacy by design](https://www.cnil.fr/fr/privacy-by-design).
- INSEE SIRENE — [API publique des entreprises](https://api.insee.fr/catalogue/site/themes/wso2/subthemes/insee/pages/item-info.jag?name=Sirene&version=V3.11&provider=insee).

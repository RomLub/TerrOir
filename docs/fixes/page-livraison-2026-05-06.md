# Page /livraison V2 — 2026-05-06

Deuxième vague des pages P0 légales/conversion : remplacement du
placeholder /livraison (créé via commit 97a4c4d) par la version
complète, avec carte SVG France des départements couverts générée
dynamiquement depuis la DB.

## Modèle livraison TerrOir actuel (rappel scope)

- Retrait à la ferme = mode principal, gratuit
- Envoi postal = mode secondaire, denrées non-périssables uniquement,
  frais forfaitaires fixés par chaque producer

Hors scope (non mentionnés sur la page) :

- Livraison à domicile dédiée (non implémentée)
- Cabane / point de collecte producteurs (V2)

## Lots livrés

### Lot 1 — Carte SVG France + helper coverage

- `lib/geo/france-departements.ts` : référentiel des **96 départements
  métropole + Corse** (95 numériques + 2A/2B) avec positions hexgrid
  (col, row). Layout cartogramme schématique : col 0..13 (ouest→est),
  row 0..12 (nord→sud). Précision suffisante pour visualiser la
  couverture marketplace, pas une carte topographique. V2 envisageable
  avec GeoJSON IGN si la précision géo devient un besoin métier.
  Helpers exportés : `getDeptByCode`, `getDeptName`,
  `deptCodeFromCodePostal` (gère métropole 2 chiffres, Corse 2A/2B
  selon préfixe 200/201/202+, DOM 97x/98x renvoyés en 3 chars).
- `components/ui/france-map-coverage.tsx` : Server Component pur. Rend
  un `<rect>` par département à partir du référentiel hexgrid. Tooltip
  via attribut SVG natif `<title>` (browser-native, accessible, zéro
  bundle JS). Hover via CSS scopé injecté dans `<style>` à l'intérieur
  du SVG (transition fill 120ms). Couleurs design system : terra-700
  `#A0522D` couvert / stone `#E7E5E4` non couvert + variantes hover
  assombries.
- `lib/products/fetch-coverage-departments.ts` : helper
  `getCoverageDepartments()` wrappé `unstable_cache(revalidate=600s,
  tags=['coverage-departments'])`. Query Supabase agrège
  `code_postal` des producers `statut='public' AND deleted_at IS NULL`
  via le helper `deptCodeFromCodePostal`. Retourne
  `{ coveredDepartments, departmentProducerCounts, totalProducers,
  totalDepartments }`. Fail-safe : erreur Supabase → payload vide +
  `console.error`. La fonction `fetchCoverageDepartmentsRaw` est
  exportée pour les tests (bypass cache Next.js).
- `lib/stats/revalidate.ts` : ajout `revalidateCoverageDepartments()`
  (server action wrapper). Wiring dans les flows publish/unpublish
  producer **non posé dans cette PR** — la carte tolère un délai de
  10 min, suffisant pour le besoin actuel. À câbler en même temps
  qu'un bouton publish/unpublish producer si la latence devient
  gênante.

### Lot 2 — Page /livraison version complète

`app/(public)/livraison/page.tsx` (Server Component, async pour data
fetch). 6 blocs :

1. **Hero** : eyebrow + h1 + intro courte
2. **Retrait à la ferme** (mode principal, en premier) : description,
   3 étapes, 4 avantages mis en avant
3. **Envoi postal** (mode secondaire) : 2 listes côte à côte
   (denrées OK / KO), comment ça marche, point "à noter"
4. **Zone géographique** : carte FranceMapCoverage avec data live,
   compteur dynamique sous la carte, CTA /contact si zone non couverte
5. **Produits non conformes** : description courte + placeholder
   violet (modalités exactes à définir) + CTA contact
6. **FAQ rapide** : 3 questions en `<details>` natif (CSS-only, pas de
   JS), première question ouverte par défaut, lien "FAQ complète" /faq
7. **CTA fin** : 3 liens — /contact, /producteurs, /comment-ca-marche

Métadonnées SEO : title, description, canonical, robots:index/follow.

### Lot 3 — Liens entrants

- `components/ui/footer.tsx` : colonne « TerrOir » renommée en
  **« Aide »** + ajout entrée /livraison entre /contact et
  /politique-confidentialite. Section reste 4-cols sur desktop.
- `app/(public)/comment-ca-marche/page.tsx` : sous le CTA principal
  « Trouver un producteur → » dans le bloc final, ajout d'un
  sous-paragraphe « En savoir plus sur les modalités : Livraison et
  retrait » (lien /livraison, style discret blanc/vert clair sur fond
  green-900).
- `app/(public)/contact/page.tsx` : retour automatique du
  rel="nofollow" sur /livraison réalisé en commit 97a4c4d (page
  désormais existante en V2).
- Home / `app/(public)/_components/home/*` : pas de modification —
  pas de section pertinente où injecter naturellement le lien sans
  forcer la composition.

### Lot 4 — Tests vitest (31 tests, +31)

- `tests/lib/geo/france-departements.test.ts` (15 tests) : invariants
  référentiel (96 dépts, codes uniques, positions (col,row) uniques,
  inclusion des 8 dépts Grand Ouest, Corse 2A/2B distincts) + helper
  `deptCodeFromCodePostal` (métropole, Corse 2A/2B, DOM 97x/98x, trim,
  null/undefined/vide).
- `tests/lib/products/fetch-coverage-departments.test.ts` (6 tests) :
  agrégation par 2 premiers chiffres CP, Corse routing, ignore null/
  vides, payload vide, erreur Supabase fail-safe, DOM en 3 chars.
- `tests/components/ui/france-map-coverage.test.tsx` (10 tests) :
  rendu via `renderToStaticMarkup` (pattern aligné
  score-carbon-block.test.tsx). Vérifie 96 `<rect>`, attribute
  `data-covered`, tooltip via `<title>` (singulier/pluriel/non-couvert),
  fill terra/stone, légende, CSS hover scopé (avec `&quot;` car React
  escape les `"` à l'intérieur de `<style>`).

Évolution suite : **1748 → 1779 tests** (149 → 152 fichiers, +31).

### Lot 5 — Doc

Ce fichier.

## Statut de la query coverage

✅ **Réussie sans adaptation schéma.**

Le schéma `producers` (cf. `20260419000000_initial_schema.sql`) expose :

- `code_postal` (text, nullable)
- `statut` text (enum incluant `'public'`)
- `deleted_at` timestamptz (nullable, anonymisation RGPD)

La query agrège côté app après `SELECT code_postal` avec filtres
`statut='public' AND deleted_at IS NULL` — cohérent avec le pattern
`fetchPublicProducerBySlug` et `getPublicStats`. Pas de risque RLS
(admin client en service role) ni PII (counts agrégés).

## Source du SVG France

❌ Pas de SVG IGN/Wikimedia importé.

✅ Cartogramme hexgrid généré 100% en code à partir de
`lib/geo/france-departements.ts`. 96 cellules `<rect>` positionnées
sur une grille (col, row). Total bundle JS additionnel : **0 octets**
(rendu 100% serveur, /livraison reste à 215 B comme un Server
Component pur).

Trade-off documenté : la précision géographique est approximative
(positions relatives fidèles : Bretagne ≈ ouest, PACA ≈ sud-est, IDF
≈ centre-nord). Pour un V2 "vraie carte" basé sur GeoJSON IGN
simplifié, voir le commentaire en tête de
`lib/geo/france-departements.ts`.

## Placeholders violets restants (`grep -rn "PLACEHOLDER" app/`)

10 occurrences sur 3 fichiers :

- `app/(public)/contact/page.tsx` (4) — héritage commit 97a4c4d
- `app/(public)/politique-confidentialite/page.tsx` (5) — héritage
- `app/(public)/livraison/page.tsx` (1, **nouveau**) — modalités
  exactes produits non conformes (délai signalement, photos preuves,
  médiation, remboursement / remplacement) à définir ultérieurement

## Trade-offs et décisions autonomes

- **Cartogramme hexgrid vs SVG géographique précis** : choix
  cartogramme — économie ~150 KB de bundle (pas de TopoJSON/GeoJSON),
  rendu 100% serveur (carte = 0 KB JS), maintenance simple (un
  fichier de 96 lignes data). Précision geo OK pour usage
  "couverture marketplace", pas un atlas.
- **Tooltip `<title>` SVG natif** : zéro JS, accessible
  (lecteurs d'écran), comportement standard. Délai d'apparition léger
  (~500ms) du tooltip natif, mais cohérent UX desktop.
- **Hover via CSS injecté dans `<style>` SVG** : permet l'effet
  hover sans JS et sans dépendre de Tailwind (les sélecteurs
  data-attribute ne sont pas exposés en variants Tailwind par
  défaut). React escape les `"` du CSS en `&quot;` dans le rendu
  static markup — le navigateur réinterprète correctement.
- **`<details>` natif pour FAQ** : zéro JS, comportement standard,
  accessible. Première Q ouverte par défaut via `open`. Pattern aligné
  avec la philosophie "Server Component pur" du reste de la page
  (vs accordion contrôlé en Client Component dans
  /comment-ca-marche).
- **Cache 10 min vs 1 min** : la coverage évolue lentement
  (validation producer = action admin manuelle). 10 min suffit, et la
  carte tolère un délai. Helper `revalidateCoverageDepartments()`
  fourni mais wiring producer-publish absent — à poser en même temps
  qu'un bouton publish dans la console admin si nécessaire.
- **Footer renommé « TerrOir » → « Aide »** : la colonne contient
  désormais 3 liens fonctionnels (Contact, Livraison, Politique) +
  ligne italique « Mentions légales · CGU · CGV — à venir ». « Aide »
  est plus parlant pour un visiteur qui cherche du SAV.
- **Sub-link discret /livraison sous CTA principal** /comment-ca-marche
  (vs un bloc CTA dédié) : le bloc CTA contact existe déjà (commit
  97a4c4d). Empiler 2 blocs CTA chargerait visuellement la page sans
  apport. Sub-link reste signal-faible mais découvrable.
- **Pas de mapbox-gl** : le repo a justement bougé mapbox en lazy.
  La carte couverture ne nécessite aucune carte interactive — un
  cartogramme schématique suffit, et la page /carte (mapbox)
  couvre déjà le besoin "rechercher producteur sur carte".
- **Aucun commit/push** : contrainte stricte, Romain commit après
  validation.

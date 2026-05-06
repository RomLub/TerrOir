# Aperçu visuel temps réel des indicateurs score carbone — chantier T-212

## Use case

Issue du rapport produit comité T-200 round 1 (03/05/2026). Aujourd'hui le
producteur saisit les 3 enums score carbone (`mode_elevage`, `alimentation`,
`densite_animale`) dans `StepInfos.tsx` **sans visibilité sur le rendu côté
fiche publique**. Conséquence observée :

- Saisies par défaut ou erronées (le producteur clique sur la première
  option par défaut).
- Pas de prise de conscience de l'impact visuel des choix (la pill colorée
  est affichée prominemment sur la fiche publique consumer).
- /ma-page (édition post-onboarding) **ne permettait même pas d'éditer**
  ces 3 enums — seule porte d'entrée = onboarding initial → erreur figée.

T-212 résout les deux : aperçu live "voici comment ça apparaîtra" dans
l'onboarding **et** ouverture de l'édition dans /ma-page.

## Architecture

### Source unique partagée — `components/producer/ScoreCarbonIndicators.tsx`

Extraction du sous-composant `IndicatorCard` + nouveau helper
`ScoreCarbonIndicators` (rend les 3 cards conditionnellement, applique les
tones couleurs canoniques). Évite la divergence visuelle "preview" ↔ "rendu
final" : une seule source pour les pills, hints et tones (vert pour
mode_elevage, terra pour alimentation, variable vert/terra/orange pour
densité animale via `DENSITE_TONE`).

`ScoreCarbonBlock` (fiche publique consumer) et `ScoreCarbonPreview`
(producteur onboarding + /ma-page) consomment **le même module**. Toute
modification visuelle future (tons, hints, ordre) se fait à un seul endroit.

### Composant aperçu — `components/producer/ScoreCarbonPreview.tsx`

Client Component, props-driven (`modeElevage | null`, `alimentation | null`,
`densiteAnimale | null`).

- Aucune valeur saisie → placeholder neutre "Sélectionnez les options
  ci-dessus pour voir l'aperçu de votre fiche publique" (ancrage E2E :
  `data-testid="score-carbon-preview-placeholder"`).
- 1+ valeur saisie → rendu via `ScoreCarbonIndicators` (label PUBLIC,
  pill, hint sous la pill — exactement comme la fiche publique).
- Badge "En direct" affiché dès qu'au moins une valeur est saisie pour
  signaler à l'utilisateur la nature live du rendu.
- `aria-live="polite"` sur le conteneur (anticipation T-215, annonce
  des mises à jour aux lecteurs d'écran).

### Intégration onboarding — `StepInfos.tsx`

Restructuration du bloc score carbone en grid 2 colonnes :

- **Desktop** (`md:grid-cols-[1fr_320px]`) : sélecteurs à gauche, preview
  sticky à droite (`md:sticky md:top-4 md:self-start`).
- **Mobile** : pile vertical, preview sous les selects.

Les 3 radios ont été passés du mode **uncontrolled** (lecture FormData
côté action) vers **controlled** (state React local) pour brancher le
preview en direct. La submission reste basée sur FormData (`name="..."`)
→ aucun impact côté `complete-onboarding` action ni Zod validator.

### Intégration /ma-page — `app/(producer)/ma-page/page.tsx`

`/ma-page` existait mais **n'éditait pas** les 3 enums score carbone.
Décision (vote du brief) : scope minimum, ajouter une **section dédiée**
sans toucher au reste de l'édition producer.

- Extension du type `Form` + `EMPTY` avec `mode_elevage | alimentation |
  densite_animale` (typés strictement).
- Extension de la query Supabase et de l'update.
- Section UI dédiée (pattern radios cards cohérent avec StepInfos pour
  la **cohérence métier** — même donnée, même paradigme d'édition), avec
  même layout 2-col / preview sticky desktop.
- Position : juste après "Labels & certifications", avant
  "Générations / Année de création".

## Tests

Fichier `tests/components/producer/score-carbon-preview.test.tsx` — 12
tests, env=node + `renderToStaticMarkup` (cohérent avec
`score-carbon-block.test.tsx`, ScoreCarbonPreview est props-driven sans
hooks/effects donc testable comme une fonction pure).

Couverture :

- **Placeholder neutre** (3 tests) : aucune valeur → placeholder, pas de
  badge "En direct", `data-testid` présent.
- **Rendu partiel** (2 tests) : 1 ou 2 enums → seules les pills
  correspondantes, pas de moignon pour les absentes, plus de placeholder
  dès qu'au moins 1 valeur.
- **Rendu complet** (3 tests) : 3 enums → 3 pills + ordre cohérent
  (mode → alim → densité), tones couleurs canoniques pour `intensive`
  (orange) et `standard` (terra) — protection régression visuelle.
- **A11y** (2 tests) : `aria-live="polite"` + pas de `title` natif sur
  les pills (cohérence T-200 r2).
- **Snapshots** (2 tests) : vide + complet → détection régression visuelle
  HTML.

Pas de test d'intégration StepInfos/ma-page (pas de
`@testing-library/react` dans le projet, et l'interaction "changement →
mise à jour preview" est garantie structurellement par le pattern
controlled radios + state + props).

## Fichiers créés / modifiés

**Créés** :

- `components/producer/ScoreCarbonIndicators.tsx` (shared : `IndicatorCard`
  + `ScoreCarbonIndicators` + `DENSITE_TONE` + tones constants)
- `components/producer/ScoreCarbonPreview.tsx` (Client Component aperçu)
- `tests/components/producer/score-carbon-preview.test.tsx` (12 tests)
- `tests/components/producer/__snapshots__/score-carbon-preview.test.tsx.snap`
  (snapshots auto-générés)
- `docs/fixes/score-carbon-preview-2026-05-06.md` (ce doc)

**Modifiés** :

- `app/(public)/producteurs/[slug]/_components/ScoreCarbonBlock.tsx`
  (suppression `IndicatorCard` interne + `DENSITE_TONE` map → import du
  shared, modif minime)
- `app/(producer)/invitation/_components/StepInfos.tsx` (controlled
  radios + grid 2-col + ScoreCarbonPreview)
- `app/(producer)/ma-page/page.tsx` (extension Form + query + update,
  nouvelle section UI radios + ScoreCarbonPreview)

## Trade-offs et décisions

1. **Extraction vs duplication** : choisi extraction (`ScoreCarbonIndicators`
   shared). Modification minime de `ScoreCarbonBlock` (juste imports +
   call), évite la dérive visuelle future. Validé par les 6 tests
   pré-existants `score-carbon-block.test.tsx` qui passent toujours sans
   modification.

2. **Pattern radios /ma-page** : choisi cohérence métier (radios cards
   identiques à StepInfos) plutôt que cohérence visuelle interne /ma-page
   (boutons pills comme "Espèces" / "Labels"). Justification : les
   `hints` sous chaque option sont **load-bearing** — c'est tout le sens
   de T-212 que d'aider le producteur à choisir consciemment.

3. **Mode controlled radios StepInfos** : passage uncontrolled → controlled.
   Coût : 3 useState supplémentaires + onChange handlers. Bénéfice :
   preview live sans `useFormState` ni reflet via `watch`. La submission
   FormData reste intacte (les `name="..."` portent les valeurs).

4. **Snapshots** : 2 snapshots écrits (vide + complet). Coût d'entretien
   modéré, mais protection forte contre régression visuelle accidentelle
   (ordre des classes, tons couleurs, structure HTML).

5. **No /ma-page MVP** : /ma-page existait déjà → pas de "MVP minimal
   créé", scope = "édition existante enrichie" avec section dédiée.

## Conformité contraintes brief

- ✅ Pas de commit Git
- ✅ Modification minime de `ScoreCarbonBlock.tsx` (extraction propre,
  réutilisation directe via shared component)
- ✅ Aucune intersection avec TA (`components/DistanceWidget*`,
  `lib/producers/coords.ts`) — vérifié par grep
- ✅ Aucune intersection avec TB (`lib/audit-logs/`,
  `app/(admin)/audit-logs/`, sidebar admin, `scripts/codegen-enums`) —
  vérifié par grep ; les 2 tests TB en échec
  (`tests/app/(admin)/audit-logs/_lib/categorize-event-type.test.ts`)
  sont pré-existants et hors scope T-212
- ✅ Pattern test vitest TerrOir respecté (env=node + `renderToStaticMarkup`)
- ✅ Style cohérent design system terra (tons `terroir-green`,
  `terroir-terra`, `terra-700`)
- ✅ Pas de migration DB (colonnes déjà créées par T-200)
- ✅ Pas de modification du schéma TS des enums

## Vitest

Avant T-212 : 1864 tests
Après T-212 : 1880 tests (+12 score-carbon-preview, +4 ailleurs en parallèle)
Tests T-212 : **12/12 passent**, 6/6 tests pré-existants
`score-carbon-block.test.tsx` passent toujours après refacto.

# T-240 — État vide indicateurs producteur (placeholder neutre)

Date : 2026-05-06
Status : Livré (composant + test + build OK)

## Problème

Avant ce fix, `ScoreCarbonBlock` retournait `null` quand le producteur
n'avait ni indicateurs catégoriels (`mode_elevage`, `alimentation`,
`densite_animale` tous NULL), ni coordonnées (`latitude` / `longitude`
NULL → pas de widget distance). Résultat : la fiche publique
producteur affichait un trou silencieux à l'emplacement de la section
« Notre démarche ».

C'est le scénario typique des producteurs créés avant T-241 (cluster
T-281), pour qui `declaration_indicateurs_*` est à NULL et qui n'ont
pas encore renseigné les enums score carbone via l'onboarding. La
mitigation pré-bascule attendue par le runbook pré-Live est un
placeholder neutre tutoyé.

## Décision UX

Quand `hasCategorical=false` ET `hasDistance=false` (i.e. les 3 enums
sont NULL et les 2 coordonnées sont NULL) → afficher un placeholder
neutre dans la section, plutôt que masquer.

Si renseignement partiel (au moins un enum OU les coords présentes)
→ comportement inchangé : on rend ce qui existe, sans moignon (cf.
décision T-200 r1, vérifiée par les Cas C/D du test).

Wording validé par le lead :

> Ce producteur n'a pas encore renseigné sa démarche.

Tutoiement consumer / troisième personne pour le producteur (cohérent
avec la fiche publique).

Headline du bloc en mode vide : version neutre `"de chez toi"`
(comme le cas maraîcher), pour ne pas pré-supposer une activité
d'élevage absente.

## Implémentation

`app/(public)/producteurs/[slug]/_components/ScoreCarbonBlock.tsx` :

- Calcul d'un flag `isEmpty = !hasCategorical && !hasDistance`
  (remplace l'`if (!hasCategorical && !hasDistance) return null`).
- Rendu d'une carte placeholder (`border-dashed`, fond blanc, texte
  centré, ton neutre) entre le header et les blocs catégoriels /
  distance, conditionné à `isEmpty`. Apostrophe écrite `&rsquo;` côté
  JSX (cohérent doctrine T-255 ESLint anti-U+2019).
- Pas de wording « éleveur » (heading reste `"de chez toi"`).

## Tests

`tests/app/producteurs/score-carbon-block.test.tsx` :

- Cas A (renommé + adapté T-240) : 0 enum + 0 lat/lng → vérifie le
  placeholder rendu (texte tutoyé), titre version neutre, absence de
  pills et de label « Distance ferme ». Pattern regex via
  `new RegExp` avec `’` escape pour rester conforme à la règle
  ESLint no-restricted-syntax (T-255).
- Cas B-E inchangés : tous passent, comportement non régressé.

Run : `npx vitest run
tests/app/producteurs/score-carbon-block.test.tsx` → **6/6 OK**.

`npm run build` local : **Compiled successfully** (105/105 static
pages générées, aucun error/warn lint).

## Cross-réf checklist

- T-281 : producteurs existants à NULL — placeholder neutre est la
  mitigation pré-bascule attendue par le runbook pré-Live.
- T-211 : repenser bloc « Démarche » modulaire selon métier (backlog,
  non bloquant Live).
- T-240 r4 (sortie cycle) : QA mobile dédiée au placeholder en
  conditions réelles (non requis pour la livraison code).

## Garde-fou

- Si un nouvel indicateur arrive (T-243 versioning enums score
  carbone), le calcul `isEmpty` restera valide tant qu'il agrège tous
  les indicateurs catégoriels via OR. Penser à étendre le check si
  un 4e enum s'ajoute.
- Le titre version « de chez toi » est rendu même en mode vide : si
  on veut un titre dédié placeholder (« Démarche à venir » p.ex.),
  rebrancher la condition sur `isEmpty` au lieu de `hasCategorical`.

# T-241 r4 — Micro-tooltips StepInfos onboarding

Date : 2026-05-06
Status : Livré (composant + intégration + tests + build OK)

## Contexte

Le brief T-241 r4 demande des micro-tooltips d'aide au choix dans le
flow `StepInfos` de l'onboarding producteur, en regard des 3 enums
score carbone (`mode_elevage`, `alimentation`, `densite_animale`). Le
HINT court existant déjà sous chaque radio (`MODE_ELEVAGE_HINTS`,
etc.) reste utile pour le scan rapide ; les tooltips ajoutent un
exemple narratif un cran plus engageant pour l'utilisateur qui hésite
sur le bon choix.

## Décisions UX

### Composant : `HelpTooltip` natif minimal

`app/(producer)/invitation/_components/HelpTooltip.tsx`. Pattern
WAI-ARIA Disclosure :
- mini-bouton « ? » (24×24 px) en regard du `<legend>` du fieldset.
- panneau `role="tooltip"` ouvert au clic, fermé au clic extérieur
  (`pointerdown` global) et à la touche `Escape`.
- `aria-expanded` sur trigger, `aria-controls` lie trigger ↔ panneau.

Pas de Radix : aucune dépendance Radix présente dans `package.json`,
contenu court statique sans positionnement sophistiqué — ajouter
une lib pour 3 boutons d'aide serait disproportionné.

Bouton trigger 24×24 px (action secondaire d'aide, pas un CTA) ; la
cible tactile reste utilisable mobile via le label cliquable du radio
englobant.

### Wordings : factuels, sans engagement chiffré

Le brief suggérait des wordings comme « Plein air = animaux dehors
>70 % du temps » ou « Densité Standard = aligné réglementation ».
Décision écartée :
- les pourcentages chiffrés (ex. « 70 % ») engageraient le producteur
  sur un seuil quantitatif sans définition opposable côté TerrOir →
  risque DGCCRF / sincérité de la déclaration.
- la référence aux « seuils légaux » introduit une garantie de
  conformité que TerrOir n'audite pas (T-282 wording governance n'a
  pas validé ce niveau d'affirmation).

Wordings finaux retenus, narratifs, non chiffrés, alignés sur le
pattern T-200 r2 (langage « ordre de grandeur » comme pour
`GMS_DISTANCE_SOURCE_LABEL`) :

- **Mode d'élevage** — « Choisis l'option qui décrit le mieux la
  conduite habituelle de tes animaux : où ils passent la majeure
  partie de leur temps (extérieur, pâture saisonnière, bâtiment avec
  ou sans accès libre au parcours). »
- **Alimentation** — « Choisis l'option qui reflète la part dominante
  de l'alimentation de tes animaux sur l'année : pâture/fourrage de
  la ferme, mix avec compléments achetés, ou alimentation
  principalement achetée. »
- **Densité animale** — « Estimation qualitative de la place dont
  disposent tes animaux : extensive si beaucoup d'espace par tête
  (faible chargement à l'hectare), standard pour la densité usuelle
  en élevage fermier, intensive pour une conduite avec infrastructure
  d'élevage adaptée. »

Tutoiement producteur cohérent avec le ton de l'onboarding existant
(« ces infos enrichissent **ta** fiche publique »).

## Fichiers modifiés

- `app/(producer)/invitation/_components/HelpTooltip.tsx` — nouveau
  composant client, pattern Disclosure ARIA, dismiss clic externe +
  Escape.
- `app/(producer)/invitation/_components/StepInfos.tsx` — import
  `HelpTooltip` + 3 instances dans les 3 `<legend>`. `mb-1 block`
  remplacé par `mb-1 flex items-center` pour aligner le bouton à
  droite du label.
- `tests/app/(producer)/invitation/HelpTooltip.test.tsx` — 6 tests
  vitest jsdom (rendu initial, ouverture clic, dismiss clic externe,
  dismiss Escape, clic interne ne dismiss pas, toggle clic trigger).

## Validation

- `npx vitest run tests/app/(producer)/invitation/HelpTooltip.test.tsx`
  → **6/6 OK**.
- `npm run build` → **Compiled successfully**, 105/105 pages
  statiques générées. Un warning `react-hooks/exhaustive-deps`
  pré-existant sur `components/providers/user-provider.tsx:118` (hors
  scope T-241 r4).

## Apostrophes — doctrine T-255

- JSX text : utilisé `&rsquo;` partout dans les wordings (rendu
  typographique courbe préservé après transformation Next.js).
- Strings JS (props `ariaLabel`, attributs `aria-label`) : utilisé
  ASCII droit `'` car `&rsquo;` dans une string TypeScript est
  interprété littéralement (et l'ESLint flagge sinon). Le screen
  reader lit naturellement « Aide : mode d'élevage » quel que soit
  l'apostrophe.

## Garde-fou

- Si on ajoute un 4e enum à terme (T-243 versioning enums), suivre
  le même pattern : tooltip co-localisé avec un `id` unique
  (`tip-<enum-snake>`), wording sobre sans pourcentages.
- Si Radix Tooltip ou Popover entre dans le repo plus tard, migrer
  `HelpTooltip` est un quick-win (3 props, surface API minime).
- Le pattern click-to-toggle est volontaire (cohérent T-200 r2 sur
  les pills publiques). Si un futur audit a11y demande un comportement
  hover-équivalent, étendre via `aria-describedby` plutôt que de
  basculer en mode hover-only (cassé sur tactile).

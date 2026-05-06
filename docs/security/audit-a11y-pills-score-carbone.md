# Audit a11y — pills score carbone — T-215

> Date audit : 2026-05-07
> Composant cible : `components/producer/ScoreCarbonIndicators.tsx`
> Critères WCAG visés : 1.4.1 (Use of Color), 1.4.3 (Contrast Minimum), 4.1.2 (Name/Role/Value)
> Statut : conforme AA — implémentation déjà livrée 2026-05-06 (commit T-215 livraison initiale)

---

## Pourquoi cette doc

Le `docs/fixes/score-carbon-a11y-2026-05-06.md` documente la livraison initiale T-215 (corrections + tests). Cette doc-ci, pendant security/, formalise le verdict d'audit pour la checklist pré-Live et fournit le cadre de re-validation à appliquer à chaque évolution future des tons couleurs.

## Surface auditée

3 pills `IndicatorCard` rendues côté :

- `/producteurs/[slug]` (consumer public) — `ScoreCarbonBlock` consomme les 3 pills
- `/ma-page` aperçu live producteur (T-212) — `ScoreCarbonPreview` consomme les mêmes pills

Source unique : `components/producer/ScoreCarbonIndicators.tsx` (commit T-215 + T-212). Toute évolution doit traverser ce fichier — pas de duplication des tons.

## Verdict critère par critère

### WCAG 1.4.3 — Contrast Minimum (AA, ≥ 4.5:1 texte normal)

| Tone                     | bg        | text      | Ratio    | Verdict        |
|--------------------------|-----------|-----------|----------|----------------|
| MODE_ELEVAGE_TONE        | `#D8F3DC` | `#2D6A4F` | 5.6:1    | OK AA          |
| ALIMENTATION_TONE        | `#F5E6DC` | `#A0522D` | 4.6:1    | OK AA          |
| DENSITE.extensive        | `#D8F3DC` | `#2D6A4F` | 5.6:1    | OK AA          |
| DENSITE.standard         | `#F5E6DC` | `#A0522D` | 4.6:1    | OK AA          |
| DENSITE.intensive        | `#FFEDD5` | `#C2410C` | 4.5:1    | OK AA (limite) |

Ratios calculés via formule WCAG 2.0 (luminance relative + (L1+0.05)/(L2+0.05)). Ratio le plus tendu = intensive 4.5:1 — sciemment conservé pour l'identité "alerte" terra-orange. Toute baisse de saturation passerait sous le seuil → ne pas toucher aux tokens `orange-100` / `orange-700` sans recalcul.

### WCAG 1.4.1 — Use of Color (AA)

- **MODE_ELEVAGE_TONE** : couleur identique pour les 4 valeurs (vert constant). L'info est portée 100% par le texte. Pas de risque d'information perdue chez un dichromat. Conforme par construction.
- **ALIMENTATION_TONE** : idem (terra constant). Conforme par construction.
- **DENSITE_TONE** : 3 couleurs hiérarchisées (vert → terra → orange) qui portent une connotation positive→neutre→négative. Sans renforcement non-couleur, un utilisateur dichromat (deutéranopie/protanopie ≈ 8% des hommes) perd la connotation. **Renforcement appliqué** : `DENSITE_ICON` Record qui ajoute respectivement `CheckIcon` / `MinusIcon` / `WarningIcon` à chaque pill DENSITE. Texte du label communique aussi ("Beaucoup d'espace" / "Espace standard" / "Élevage dense"). Double signal texte + picto = conforme.

### WCAG 4.1.2 — Name, Role, Value (AA)

`<span aria-label="${eyebrow} : ${label}">` enrichi sur chaque pill. Lecture screen reader sortie de contexte : "Densité animale : Beaucoup d'espace" au lieu de "Beaucoup d'espace" seul. Cohérent ARIA Authoring Practices.

Le hint sous la pill (`<p class="text-[12px]">`) reste lu en DOM order — pas besoin de `aria-describedby`. Décision T-200 round 2 confirmée : pas de `title` HTML natif (tooltip mobile inconsistant).

## Tests automatisés

`tests/components/producer/score-carbon-preview.test.tsx` couvre :

1. `aria-label` présent sur les 3 pills avec format `${eyebrow} : ${label}`.
2. Picto SVG présent uniquement sur DENSITE.intensive (et standard/extensive) — absent sur MODE/ALIM.
3. Snapshots regen incluant les SVG inline.

Run : `npx vitest run tests/components/producer/score-carbon-preview.test.tsx`.

## Procédure de re-validation à chaque évolution

1. Si bump de tone (ajout d'un nouveau `DENSITE` value, changement palette terroir-green/terra) → recalculer le ratio de contraste avec le nouveau couple bg/text. Outil rapide : <https://webaim.org/resources/contrastchecker/>.
2. Si nouvelle catégorie de pill avec connotation good/bad portée par couleur → ajouter un picto non-couleur (`CheckIcon` / `MinusIcon` / `WarningIcon` réutilisables, ou nouveau si la sémantique l'impose).
3. Run `npx vitest run` pour vérifier que les tests a11y restent verts.
4. Lecture screen reader manuelle (NVDA / VoiceOver) sur la fiche `/producteurs/[slug]` recommandée si la structure DOM change.

## Backlog ouvert (hors scope T-215)

- **Audit a11y transverse** des autres pills/badges du projet (`ProducerStatusBadge`, `OrderStatusBadge`, `StatusDotBadge`) — mêmes principes à appliquer si connotation good/bad portée par couleur.
- **Tooling axe-core en CI** — automatiser la vérification du contraste sur tous les composants qui rendent du texte coloré.

## Références

- Implémentation : `components/producer/ScoreCarbonIndicators.tsx`
- Tests : `tests/components/producer/score-carbon-preview.test.tsx`
- Récap livraison : `docs/fixes/score-carbon-a11y-2026-05-06.md`
- Threat model PII coordonnées : `docs/security/threat-reidentification-producteur-2026-05-06.md`

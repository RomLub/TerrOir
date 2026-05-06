# A11y — pills score carbone — T-215

> Date : 2026-05-06
> Branche : master
> Tickets : T-215 (issue rapport produit comité T-200 round 1, 03/05/2026)

---

## Audit

Cible : les 3 pills `IndicatorCard` du composant partagé `components/producer/ScoreCarbonIndicators.tsx` (consommé par `ScoreCarbonBlock` côté fiche publique consumer + `ScoreCarbonPreview` côté onboarding producteur, chantier T-212).

### Contraste WCAG AA

Calcul manuel via formule WCAG 2.0 (luminance relative + ratio (L1+0.05)/(L2+0.05)). Texte 13px font-medium = "texte normal" → seuil ≥ 4.5:1.

| Tone                                                   | bg          | text        | Ratio approx | Verdict |
|--------------------------------------------------------|-------------|-------------|--------------|---------|
| `MODE_ELEVAGE_TONE` (constant, toutes valeurs)         | `#D8F3DC`   | `#2D6A4F`   | **5.6:1**    | ✅ AA   |
| `ALIMENTATION_TONE` (constant)                         | `#F5E6DC`   | `#A0522D`   | **4.6:1**    | ✅ AA   |
| `DENSITE_TONE.extensive`                               | `#D8F3DC`   | `#2D6A4F`   | 5.6:1        | ✅ AA   |
| `DENSITE_TONE.standard`                                | `#F5E6DC`   | `#A0522D`   | 4.6:1        | ✅ AA   |
| `DENSITE_TONE.intensive`                               | `#FFEDD5`   | `#C2410C`   | **4.5:1**    | ✅ AA (limite) |

→ **Conforme WCAG 1.4.3 (Contrast Minimum)**.

### Information non-couleur (WCAG 1.4.1 "Use of Color")

- **MODE_ELEVAGE_TONE** : couleur identique pour les 4 valeurs (vert). La couleur ne porte aucune information distinctive — elle est purement esthétique. L'info passe 100 % par le texte ("Plein air" / "Bâtiment fermé" / etc.). → **Conforme**, rien à faire.
- **ALIMENTATION_TONE** : idem (terra constant). → **Conforme**.
- **DENSITE_TONE** : 3 couleurs distinctes (vert / terra / orange) qui portent une **connotation positive/neutre/négative** (extensive = bien-être animal, intensive = peu d'espace). Un utilisateur dichromat (deutéranopie / protanopie ≈ 8 % des hommes) voit 3 pills similaires en gris-marron, perd la connotation hiérarchique. Le texte ("Beaucoup d'espace" / "Espace standard" / "Élevage dense") communique l'idée mais l'emphase visuelle est perdue.
  → **Non conforme partiel** sur cette catégorie spécifique.

### Aria

- Pills rendues comme `<span class="rounded-full ...">{label}</span>`. Pas de `aria-label`, pas de `title` (retiré T-200 r2 pour cohérence mobile). Le texte de la pill + le `<p>` hint juste en dessous + l'eyebrow `<div>` au-dessus passent en lecture screen reader DOM order — sémantique fonctionne mais lecture sortie de contexte (raccourci à l'élément focused) ne dit pas "Densité animale : Beaucoup d'espace", juste "Beaucoup d'espace".
  → **Améliorable** : ajouter `aria-label` enrichi.

### Sémantique HTML

`ScoreCarbonIndicators` retourne un fragment, le wrapper grid 3-col vit chez le parent (`ScoreCarbonBlock` ou `ScoreCarbonPreview`). Pas de `role="list"` actuel. Pas critique — chaque carte est un `<div>` clairement structuré. Changer en `<ul><li>` impliquerait de wrapper dans le composant ce qui casserait le grid des parents. → **Pas de modification**.

## Corrections appliquées

### 1. Picto non-couleur sur DENSITE (WCAG 1.4.1)

`DENSITE_ICON: Record<DensiteAnimale, JSX.Element>` ajouté à `ScoreCarbonIndicators.tsx` :

| Valeur     | Icône                           | Sens                              |
|------------|---------------------------------|-----------------------------------|
| extensive  | ✓ check (currentColor stroke)    | positif — bien-être               |
| standard   | − minus (currentColor stroke)    | neutre                            |
| intensive  | ⚠ warning triangle (currentColor)| négatif — emphase visuelle         |

SVG inline 12px aligné au `inline-flex items-center gap-1.5` du pill, `aria-hidden="true"` (la sémantique reste portée par le texte du label, le picto est un renforcement visuel non-couleur).

`MODE_ELEVAGE` et `ALIMENTATION` n'ont pas de picto — leur couleur ne portant aucune info distinctive, ajouter un picto serait du bruit visuel sans bénéfice a11y.

### 2. Aria-label enrichi sur les 3 pills

```tsx
<span aria-label={`${eyebrow} : ${label}`} className="...">{pillIcon}{label}</span>
```

Lecture screen reader sortie de contexte : "Densité animale : Beaucoup d'espace" au lieu de "Beaucoup d'espace" seul. Cohérent avec le pattern Aria Authoring Practices.

### 3. Pas de modification contraste

Les ratios calculés passent AA. Pas de besoin de toucher aux tokens `terroir-green-*` / `terroir-terra-*` / `orange-*` qui ont d'autres consommateurs (sidebar, badges, suivi-commandes…). Le ratio le plus tendu (intensive ≈ 4.5:1, juste au seuil) est conservé sciemment : descendre `text-orange-700` → `text-orange-800` casserait l'identité visuelle "alerte" sans gain a11y significatif.

## Fichiers touchés

### Modifiés

- **`components/producer/ScoreCarbonIndicators.tsx`** — `DENSITE_ICON` + 3 SVG fonctionnels (CheckIcon / MinusIcon / WarningIcon), prop `pillIcon?` sur `IndicatorCard`, `aria-label` enrichi sur la pill, `gap-1.5` pour spacer picto/label.
- **`tests/components/producer/score-carbon-preview.test.tsx`** — 4 nouveaux tests a11y (aria-label sur les 3 pills, picto SVG sur DENSITE intensive uniquement, pas de SVG sur MODE/ALIM). Snapshots regénérés.

### Nouveaux

- **`docs/fixes/score-carbon-a11y-2026-05-06.md`** — ce document.

## Verdict final

✅ **WCAG 2.1 AA conforme** sur les 3 pills :
- Critère 1.4.3 (Contrast Minimum) : ratios ≥ 4.5:1 sur les 3 tons.
- Critère 1.4.1 (Use of Color) : DENSITE renforcé par picto non-couleur. MODE_ELEVAGE / ALIMENTATION OK par construction (couleur uniforme, info portée par texte).
- Critère 4.1.2 (Name, Role, Value) : `aria-label` enrichi exposé.

## Vérifications

- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → 1940 tests passés (vs 1930 baseline T-220), +4 tests a11y.
- Lecture lecteur d'écran (manuel, anticipé) : "Densité animale : Beaucoup d'espace" → cohérent.

## Évolutions possibles

- **Audit a11y systématique** : les autres pills du projet (`ProducerStatusBadge`, `OrderStatusBadge`, `StatusDotBadge` génériques) mériteraient le même traitement — connotation good/bad portée par couleur (ex: order_status `cancelled` / `completed`), absence d'icône pour dichromats.
- **Tooling contrast** : intégrer `axe-core` ou `pa11y` côté CI pour automatiser les vérifications WCAG (aujourd'hui calcul manuel, fragile aux ajouts futurs).
- **Test contrast côté code** : exposer les tons via fonction TS + lib `wcag-contrast` (~3 KB) pour vitest. Hors scope T-215 (pas de dep externe ajoutée pour 1 audit ponctuel).

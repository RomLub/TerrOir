# T-239 — Audit code mobile bloc score carbone

Date : 2026-05-06
Status : Conforme — aucun fix de code requis
Scope : audit code uniquement (pas de QA device réelle, cf. brief)

## Périmètre audité

Trois composants forment le bloc « Notre démarche / score carbone »
visible sur la fiche publique producteur :

1. `app/(public)/producteurs/[slug]/_components/ScoreCarbonBlock.tsx`
   — wrapper section + heading adaptatif éleveur/maraîcher.
2. `components/producer/ScoreCarbonIndicators.tsx` — `IndicatorCard`
   x 3 (mode élevage, alimentation, densité animale) + pictogrammes
   non-couleur (T-215).
3. `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx` —
   widget distance avec états replié / déployé / résultat / hors-zone.

Critères vérifiés : écrans étroits 320→414 px, touch targets ≥ 44 px,
troncature nom producteur, classes responsives Tailwind, absence de
width fixe casseur.

## Résultats par critère

### Layout responsive (320→414 px)

- `ScoreCarbonBlock` : `mx-auto max-w-7xl px-6 py-16 md:py-24`,
  conteneur fluide. Heading `text-[32px] md:text-[44px]`,
  paragraphe `text-[15px]`, `max-w-[560px] md:max-w-none`.
- Grid indicateurs : `mt-10 grid gap-4 md:grid-cols-3` — se stack en
  une colonne en mobile, 3 colonnes ≥ 768 px.
- `IndicatorCard` : `rounded-xl border ... p-5`. Card largeur 100 %
  parent grid. Aucun `width:` fixe.
- Distance result : `grid gap-5 md:grid-cols-2` — stacké mobile,
  2 colonnes desktop. Chiffre `text-[44px] md:text-[52px]`.
- Pas de `overflow-x` exposé en mobile — l'audit `text-[Npx]` ne fait
  pas exploser la largeur ; `padding`/`gap` en rem proportionnels.

→ **OK**.

### Touch targets ≥ 44 px

- `CollapsedButton` (état replié, action principale) : `h-11`
  (= 44 px) explicite. Commentaire lignes 366-367 confirme l'intention
  Apple HIG / Android Material.
- Bouton « Utiliser ma position » : `h-11`, commentaire ligne 301-302
  identique.
- Input code postal : `h-11`. Bouton « OK » : `h-11`.
- `CollapseLink` (« Masquer ») : sous 44 px car action textuelle
  secondaire avec `aria-label` enrichi pour a11y. **Acceptable** —
  pas un CTA primaire, pattern Disclosure standard.
- Bouton « Changer ma position » : `h-9` (36 px). Documenté ligne
  497-498 comme action secondaire textuelle, le primaire restant à
  44 px. **Acceptable** dans le contexte (résultat affiché, pas de
  parcours qui se bloque si un mis-tap a lieu).

→ **OK** sur les actions critiques. Les actions secondaires sont
volontairement plus petites avec justification documentée et
alternative primaire à 44 px.

### Troncature nom producteur

- `formatProducerNameForWidget(name)` (lignes 66-71) substitue le nom
  par `"cette ferme"` au-delà de 30 caractères. Seuil dérivé du
  benchmark des noms producteurs onboardés (médiane ~18, p90 ~28).
- Réutilisé partout où le nom apparaît dans le widget : panel invite
  ligne 291, `DistanceResult` ligne 455, `DistanceOutOfReach` ligne
  532.
- Choix produit T-233 documenté : pas de `truncate` CSS car le nom
  complet est déjà lisible plus haut sur la fiche, la formulation
  neutre `"cette ferme"` est plus naturelle qu'un nom mutilé.
- `IndicatorCard` n'affiche pas de nom producteur, donc rien à
  tronquer.

→ **OK**.

### A11y mineurs déjà couverts (T-273, T-215)

- Pattern WAI-ARIA Disclosure : `aria-expanded` + `aria-controls` sur
  trois triggers du même panneau (lignes 47, 364-365, 384-385).
- Pictogrammes non-couleur sur densité (info dichromat T-215).
- `aria-label` enrichi sur pills (`<eyebrow> : <label>`).
- Contraste WCAG AA validé sur les 3 tons (cf. score-carbon-a11y).

## Verdict

Le bloc score carbone est conforme aux exigences mobile (320→414 px)
en code source : layout fluide, touch targets 44 px sur actions
critiques, gestion noms longs robuste, a11y déjà câblée.

**Aucune modification de code requise.** Toute QA device réelle reste
à conduire le jour J (T-239 round 5 si gap remonte). Pas de commit
JSX, pas de `npm run build` à passer.

## Garde-fou

Si une régression mobile est constatée plus tard :
- Vérifier qu'aucun nouveau call-site du DistanceWidget n'a sauté le
  passage par `formatProducerNameForWidget` (le wrapper est exporté à
  cet effet).
- Vérifier que les nouvelles classes Tailwind n'introduisent pas de
  `w-[Npx]` fixe sur un conteneur de carte.
- Si on ajoute un 4e indicateur (T-243 / re-coche v1.1 wording),
  l'`md:grid-cols-3` doit basculer en `md:grid-cols-4` ou mieux
  en `md:grid-cols-2 lg:grid-cols-4` pour préserver la lisibilité
  tablette portrait.

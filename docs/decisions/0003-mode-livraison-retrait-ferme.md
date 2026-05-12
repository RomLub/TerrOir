# ADR-0003 — Mode de livraison : retrait à la ferme uniquement

- **Statut** : Accepted
- **Date** : 2026-05-13 (décision Romain 2026-05-07)
- **Décideurs** : Romain

## Contexte

Au moment du cadrage initial, plusieurs modes de livraison étaient
ouverts : expédition postale, point relais, livraison à domicile,
retrait à la ferme. Le code et la doc contenaient des traces des trois
options (`app/(public)/livraison/page.tsx`, mentions « expédition » dans
CGV article 6, `Reassurance.tsx` parlant de « livraison »).

## Décision

**Mode unique : retrait à la ferme.** Pas d'expédition postale, pas de
point relais, pas de livraison à domicile.

Wording UI revu en conséquence (commit `3ad1080`) :
- `Reassurance.tsx` : point relais retiré
- `PickupValidationCard.tsx` : « Confirmer la livraison » → « Confirmer
  la remise »

## Conséquences

**Effets positifs :**
- ✅ Modèle opérationnel simple : pas de logistique tierce à intégrer,
  pas de SLA d'expédition à gérer, pas de gestion retour colis.
- ✅ Argument produit fort : circuit court physique, rencontre
  producteur ↔ consumer, ancrage local Sarthe.
- ✅ Stripe Connect : pas de fees expédition à modéliser dans les
  splits.
- ✅ Cohérent avec le wording DGCCRF « ~1500 km circuit long » du
  DistanceWidget — pas de contradiction entre « on défend le circuit
  court » et « on expédie partout en France ».

**Contraintes acceptées :**
- ❌ Marché adressable limité par la zone de retrait du producteur.
  Mitigation : multi-producteurs sur la même zone, pas une seule
  exploitation.
- ❌ Friction UX consumer : il doit physiquement se déplacer. Mitigation
  : créneau retrait choisi par le consumer (slots), code retrait
  TRR-XXXXX généré par le système pour preuve.
- ❌ Doctrine wording stricte : aucune mention « expédition »,
  « livraison à domicile », « envoi » ne doit subsister en UI ou en
  CGV/CGU. Une régression wording = un message marketing contradictoire.

**Items non encore traités au moment de la décision (à clore avec
l'avocat dans le cadre de T-003 audit pré-Live)** :
- `app/(public)/cgv/page.tsx` article 6 mentionne encore l'expédition
  postale (lignes 480-481, 489, 357, 204).
- `app/(public)/livraison/page.tsx` à recadrer ou rediriger vers
  `/retrait`.
- `app/(public)/cgu/page.tsx`, `mentions-legales`, `contact`, `faq`,
  `comment-ca-marche` à auditer pour cohérence.

Ces modifications sont **juridiques** et conditionnées à la revue
avocat — pas une mise à jour wording libre.

## Évolution future

Si TerrOir devait ré-ouvrir un mode d'expédition (ex : extension
nationale post-élargissement géo), cet ADR serait `Superseded by ADR-YYYY`
et **non modifié** (la décision d'origine reste vraie pour son contexte).

## Liens

- `components/consumer/Reassurance.tsx`
- `components/producer/PickupValidationCard.tsx`
- Wording DGCCRF DistanceWidget : `components/consumer/DistanceWidget.tsx`
- CGV à reviser : `app/(public)/cgv/page.tsx`
- Engagement avocat conditionné : voir
  `docs/post-launch-checklist.md` item T-003

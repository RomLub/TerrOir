// Slugs des catégories qui exposent les selects "Animal" + "Morceau"
// dans le formulaire produit producteur (T-220 PR-B).
//
// Source : valeurs `slug` seedées dans `product_categories` par la
// migration PR-A (`20260501002856_t220_pra_categories_animals_cuts`).
//
// Quand une catégorie est ajoutée plus tard et qu'elle référence une
// espèce animale (ex: 'poissons-coquillages'), ajouter son slug ici.
// Le formulaire conditionne uniquement l'affichage des 2 selects sur
// cette liste — la cohérence DB est gérée par les FK nullables.

export const CATEGORIES_WITH_ANIMAL: readonly string[] = [
  'viande',
  'charcuterie',
];

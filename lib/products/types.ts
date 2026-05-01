// Types des référentiels catégorisation produit (T-220).
//
// Reflètent strictement les schémas DB des 3 tables seedées par la
// migration PR-A (`20260501002856_t220_pra_categories_animals_cuts`) :
//   - product_categories : catégorie globale (viande, fromages...)
//   - animals            : espèce animale (boeuf, porc...)
//   - cuts               : morceau scoped par animal_id (entrecote...)
//
// Tous les champs sont non-null en DB (cf. migration). Pas de generated
// type Database — on déclare manuellement le shape minimal nécessaire.

export type ProductCategory = {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
};

export type Animal = {
  id: string;
  slug: string;
  name: string;
  sort_order: number;
};

export type Cut = {
  id: string;
  animal_id: string;
  slug: string;
  name: string;
  sort_order: number;
};

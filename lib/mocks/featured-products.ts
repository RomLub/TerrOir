import type { ProductCardData } from "@/components/ui/product-card";

// Mocks "produits du moment" — section FeaturedProducts de la home consumer.
//
// Phase 1 : data hardcodée fidèle au screen handoff (4 produits cohérents
// avec les 4 producteurs ancrés dans la copy : Coulaines, Allonnes,
// Vibraye, Saosnes).
//
// Phase 2 : remplacer ce module par une query Supabase
// `getFeaturedProducts({ limit: 4 })` dans lib/queries/products/. Le shape
// ProductCardData reste l'interface stable.
//
// IDs en slug pour faciliter la navigation future (/produits/{id}).

export const FEATURED_PRODUCTS: ProductCardData[] = [
  {
    id: "poulet-fermier-tilleuls-1-8kg",
    name: "Poulet fermier · 1,8 kg",
    price: 14.8,
    unit: "pièce",
    stockLeft: 3,
    producer: "Ferme des Tilleuls — Coulaines",
    category: "Volaille",
    image: null,
  },
  {
    id: "carottes-sables-huisne",
    name: "Carottes des sables",
    price: 3.2,
    unit: "botte",
    stockLeft: 24,
    producer: "Maraîchage de l’Huisne — Allonnes",
    category: "Légumes",
    image: null,
  },
  {
    id: "crottin-frais-vibraye-80g",
    name: "Crottin frais de chèvre",
    price: 4.5,
    unit: "pièce 80 g",
    stockLeft: 18,
    producer: "Chèvrerie de Vibraye — Vibraye",
    category: "Fromage",
    image: null,
  },
  {
    id: "pommes-reinette-mans-saosnes",
    name: "Pommes Reinette du Mans",
    price: 2.8,
    unit: "kg",
    stockLeft: 6,
    producer: "Verger de Saosnes — Saosnes",
    category: "Fruits",
    image: null,
  },
];

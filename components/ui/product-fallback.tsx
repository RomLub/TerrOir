import { CategoryIcon } from "./category-icon";

// Fallback visuel quand un produit n'a pas (encore) de photo uploadée
// par son producteur. Carré fond terra-100 + icône catégorie centrée
// terra-800 (PR3 audit photos 2026-05-17 : remplace les URLs Unsplash
// hardcodées PRODUCT_PHOTOS beef/pork/lamb dans ProducerPageClient.tsx).
//
// `category` accepte le slug ("viande") ou le nom user-facing ("Viande",
// "Légumes", "Œufs"), normalisation interne via CategoryIcon. Catégorie
// inconnue ou absente → panier en osier (icône fallback).
//
// `className` paramètre le container externe (taille, aspect-ratio,
// rounded). `iconClassName` paramètre l'icône (taille, couleur). Les
// défauts conviennent à une card produit standard ; l'appelant peut
// surcharger pour des contextes plus serrés (thumbs panier 80×80, par
// exemple).

export type ProductFallbackProps = {
  category?: string;
  className?: string;
  iconClassName?: string;
};

export function ProductFallback({
  category,
  className = "",
  iconClassName = "h-1/3 w-1/3 text-terra-800",
}: ProductFallbackProps) {
  return (
    <div
      className={`flex items-center justify-center bg-terra-100 ${className}`}
    >
      <CategoryIcon category={category} className={iconClassName} />
    </div>
  );
}

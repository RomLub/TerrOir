import { ProductPageSkeleton } from './_components/ProductPageSkeleton';

// Fallback de transition de route pour la fiche produit. Sans ce fichier,
// Next remonterait au loading.tsx du segment parent (producteurs/[slug]/),
// dont le skeleton a la forme d'une fiche producteur — mauvaise forme ici.
// On réutilise le même skeleton que le fallback <Suspense> de la page pour
// une transition cohérente (cf. page.tsx, pattern shell streamé).
export default function ProductPageLoading() {
  return <ProductPageSkeleton />;
}

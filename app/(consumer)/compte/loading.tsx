// Skeleton segment /compte/* — boundary de chargement co-localisée AU NIVEAU
// du layout /compte (navbar + sidebar + footer). Conséquence : à l'entrée
// dans /compte, le shell s'affiche immédiatement et seul le contenu
// ({children} du layout) montre ce squelette — au lieu de remonter au
// (consumer)/loading.tsx situé AU-DESSUS du shell (qui remplacerait navbar +
// sidebar). Entre pages sœurs, c'est le <Suspense> par page qui prend le
// relais. On réutilise ListSkeleton pour rester cohérent avec ces fallbacks.
import { ListSkeleton } from "./_components/ContentSkeletons";

export default function CompteLoading() {
  return <ListSkeleton rows={4} />;
}

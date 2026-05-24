// Skeleton segment (producer)/ — affiché uniquement à l'entrée « à froid »
// dans l'espace producteur (résolution session/host du layout). La sidebar
// est rendue par le layout (producer) via <ProducerSidebar> ; ce loading ne
// couvre QUE la zone <main>. Entre pages sœurs, c'est le <Suspense> par page
// qui prend le relais (la sidebar reste alors fixe). On réutilise le squelette
// dashboard pour rester cohérent avec ces fallbacks par page.
import { DashboardSkeleton } from "./_components/ContentSkeletons";

export default function ProducerLoading() {
  return <DashboardSkeleton />;
}

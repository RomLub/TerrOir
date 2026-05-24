// Skeleton segment (admin)/ — affiché uniquement à l'entrée « à froid » dans
// l'espace admin (résolution session/isAdmin/host du layout). Le header + la
// sidebar admin sont rendus par (admin)/layout.tsx ; ce loading ne couvre QUE
// la zone de contenu. Entre pages admin, c'est le <Suspense> par page qui
// prend le relais (le shell reste alors fixe). On réutilise ListSkeleton pour
// rester cohérent avec ces fallbacks par page.
import { ListSkeleton } from "./_components/ContentSkeletons";

export default function AdminLoading() {
  return <ListSkeleton rows={8} />;
}

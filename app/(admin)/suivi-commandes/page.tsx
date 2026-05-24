import { Suspense } from 'react';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchAdminOrdersList } from '@/lib/admin/orders/fetch';
import { ListSkeleton } from '../_components/ContentSkeletons';
import { SuiviCommandesClient } from './SuiviCommandesClient';

// Server Component — audit Vercel C-4 (2026-05-05). (admin)/layout.tsx fait
// déjà le check session + isAdmin + host. Chantier 5 : la query (200 dernières
// commandes) est factorisée dans lib/admin/orders/fetch ; le sub-client gère
// filter pills + search + export CSV (interactions purement locales).
// Lot B perf : le fetch (200 commandes) est streamé via <Suspense> pour que
// le shell admin reste fixe.

// Coquille SYNCHRONE (streaming Suspense) : aucun accès dynamique en tête, la page
// retourne immédiatement le <Suspense>. Le fetch (200 commandes) vit dans le
// contenu streamé pour que le shell admin soit rendu tout de suite (Suspense).
export default function AdminCommandesPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <SuiviCommandesContent />
    </Suspense>
  );
}

async function SuiviCommandesContent() {
  const admin = createSupabaseAdminClient();
  const { rows, error } = await fetchAdminOrdersList(admin);

  return <SuiviCommandesClient initialOrders={rows} initialError={error} />;
}

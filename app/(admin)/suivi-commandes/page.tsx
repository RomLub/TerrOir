import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchAdminOrdersList } from '@/lib/admin/orders/fetch';
import { SuiviCommandesClient } from './SuiviCommandesClient';

// Server Component — audit Vercel C-4 (2026-05-05). (admin)/layout.tsx fait
// déjà le check session + isAdmin + host. Chantier 5 : la query (200 dernières
// commandes) est factorisée dans lib/admin/orders/fetch ; le sub-client gère
// filter pills + search + export CSV (interactions purement locales).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminCommandesPage() {
  const admin = createSupabaseAdminClient();
  const { rows, error } = await fetchAdminOrdersList(admin);

  return <SuiviCommandesClient initialOrders={rows} initialError={error} />;
}

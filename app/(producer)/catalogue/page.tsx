import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchProducerForUser, type ProducerRecord } from '@/lib/producers/context';
import { ListSkeleton } from '../_components/ContentSkeletons';
import { CatalogueClient, type CatalogueProduct } from './CatalogueClient';

// Server Component — audit Vercel C-4 + H-5 (2026-05-05).
// Avant : 'use client' + auth.getUser() + producers + products au mount
// (waterfall). Maintenant : pattern coquille SSR avec admin client + filter
// explicite par producer_id (cohérence dashboard). Lot B perf : le fetch
// products est streamé via <Suspense> pour que la sidebar reste fixe.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Coquille SYNCHRONE : <Suspense> + skeleton sans await en tête ; gardes
// déplacées dans le flux (CatalogueGate) → cadre instantané à la navigation.
export default function ProducerCataloguePage() {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <CatalogueGate />
    </Suspense>
  );
}

async function CatalogueGate() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = await createSupabaseServerClient();
  const producer = await fetchProducerForUser(supabase, session.id);
  if (!producer) redirect('/invitation');

  return <CatalogueContent producer={producer} />;
}

async function CatalogueContent({ producer }: { producer: ProducerRecord }) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('products')
    .select('id, nom, prix, unite, stock_disponible, stock_illimite, active, photos')
    .eq('producer_id', producer.id)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const initialProducts: CatalogueProduct[] = (data ?? []).map((p) => ({
    id: p.id,
    nom: p.nom,
    prix: Number(p.prix),
    unite: p.unite ?? 'kg',
    stock: p.stock_disponible ?? 0,
    unlimited: !!p.stock_illimite,
    active: !!p.active,
    image: Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null,
  }));

  return (
    <CatalogueClient
      initialProducts={initialProducts}
      producerSlug={producer.slug}
      producerStatut={producer.statut}
    />
  );
}

import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchProducerForUser } from '@/lib/producers/context';
import { AvisClient, type AvisRow } from './AvisClient';

// Page producer "Mes avis" — liste les avis publiés et permet d'y répondre
// (CGU 6.4). Les avis pending/rejected ne sont pas affichés ici car ils
// ne sont pas visibles publiquement, donc une réponse n'aurait pas de sens.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ProducerAvisPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = await createSupabaseServerClient();
  const producer = await fetchProducerForUser(supabase, session.id);
  if (!producer) redirect('/invitation');

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('reviews')
    .select(`
      id, note, commentaire, created_at, published_at,
      producer_response, producer_response_at, producer_response_updated_at,
      producer_response_locked_at, producer_response_status,
      consumer:consumer_id ( prenom, nom )
    `)
    .eq('producer_id', producer.id)
    .eq('statut', 'published')
    .order('published_at', { ascending: false, nullsFirst: false });

  if (error) throw error;

  const rows: AvisRow[] = (data ?? []).map((r) => {
    const consumer = Array.isArray(r.consumer) ? r.consumer[0] : r.consumer;
    const author = (() => {
      const prenom = consumer?.prenom?.trim() ?? '';
      const initiale = consumer?.nom?.[0] ?? '';
      const built = [prenom, initiale ? `${initiale}.` : ''].filter(Boolean).join(' ').trim();
      return built || 'Anonyme';
    })();
    return {
      id: r.id,
      author,
      rating: r.note ?? 0,
      comment: r.commentaire ?? '',
      createdAt: r.created_at as string,
      publishedAt: r.published_at as string | null,
      response: r.producer_response,
      responseAt: r.producer_response_at as string | null,
      responseUpdatedAt: r.producer_response_updated_at as string | null,
      responseLockedAt: r.producer_response_locked_at as string | null,
      responseStatus: r.producer_response_status as AvisRow['responseStatus'],
    };
  });

  return <AvisClient initialRows={rows} />;
}

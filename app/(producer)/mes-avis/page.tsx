import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchProducerForUser, type ProducerRecord } from '@/lib/producers/context';
import {
  compareReviewConversationState,
  getReviewConversationState,
} from '@/lib/producers/review-conversation-state';
import { ListSkeleton } from '../_components/ContentSkeletons';
import { AvisClient, type AvisRow } from './AvisClient';

// Page producer "Mes avis" — liste les avis publiés et permet d'y répondre
// (CGU 6.4). Les avis pending/rejected ne sont pas affichés ici car ils
// ne sont pas visibles publiquement, donc une réponse n'aurait pas de sens.
// Lot B perf : le fetch reviews est streamé via <Suspense> (sidebar fixe).

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Coquille SYNCHRONE : <Suspense> + skeleton sans await en tête ; gardes
// déplacées dans le flux (AvisGate) → cadre instantané à la navigation.
export default function ProducerAvisPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <AvisGate />
    </Suspense>
  );
}

async function AvisGate() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = await createSupabaseServerClient();
  const producer = await fetchProducerForUser(supabase, session.id);
  if (!producer) redirect('/invitation');

  return <AvisContent producer={producer} />;
}

async function AvisContent({ producer }: { producer: ProducerRecord }) {
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

  const reviewIds = (data ?? []).map((r) => r.id as string);
  const readByReviewId = new Map<string, string>();
  if (reviewIds.length > 0) {
    const { data: reads, error: readsError } = await admin
      .from('review_producer_reads')
      .select('review_id, read_at')
      .eq('producer_id', producer.id)
      .in('review_id', reviewIds);

    if (readsError) throw readsError;

    for (const read of reads ?? []) {
      readByReviewId.set(read.review_id as string, read.read_at as string);
    }
  }

  const rows: AvisRow[] = (data ?? []).map((r) => {
    const consumer = Array.isArray(r.consumer) ? r.consumer[0] : r.consumer;
    const author = (() => {
      const prenom = consumer?.prenom?.trim() ?? '';
      const initiale = consumer?.nom?.[0] ?? '';
      const built = [prenom, initiale ? `${initiale}.` : ''].filter(Boolean).join(' ').trim();
      return built || 'Anonyme';
    })();
    const producerReadAt = readByReviewId.get(r.id as string) ?? null;
    const conversation = getReviewConversationState({
      createdAt: r.created_at as string | null,
      publishedAt: r.published_at as string | null,
      producerResponse: r.producer_response,
      producerResponseAt: r.producer_response_at as string | null,
      producerResponseUpdatedAt: r.producer_response_updated_at as string | null,
      producerResponseStatus: r.producer_response_status as AvisRow['responseStatus'],
      producerReadAt,
    });

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
      producerReadAt,
      ...conversation,
    };
  }).sort((a, b) => compareReviewConversationState(a, b));

  return <AvisClient initialRows={rows} />;
}

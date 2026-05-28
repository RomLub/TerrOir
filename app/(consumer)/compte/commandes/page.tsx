import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { applyCursor, parseCursor } from '@/lib/pagination/cursor';
import type { OrderStatus } from '@/components/ui';
import { formatOrderNumber } from '@/lib/orders/order-number';
import { ListSkeleton } from '../_components/ContentSkeletons';
import { CommandesClient, type OrderRow } from './CommandesClient';

// Server Component — audit Vercel C-4 + H-5 (2026-05-05).
// Avant : 'use client' + auth.getUser() + Promise.all([orders, count])
// au mount → waterfall client. Maintenant : SSR coquille, fetch parallèle
// côté serveur, hydratation directe du sub-client.
//
// (consumer)/layout.tsx fait déjà le check session ; getSessionUser() est
// dédupliqué via React cache, donc le double appel ici n'est pas un round-
// trip supplémentaire.

const VOID_ORDER_REASONS: ReadonlySet<string> = new Set([
  'payment_failed',
  'revival_blocked_stock',
  'revival_blocked_slot',
]);

function isVoidOrderRow(o: { statut: OrderStatus; closure_reason: string | null }): boolean {
  return (
    o.statut === 'cancelled' &&
    o.closure_reason !== null &&
    VOID_ORDER_REASONS.has(o.closure_reason)
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

function searchParamsToUrlSearchParams(sp: SearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') out.set(k, v);
  }
  return out;
}

// Coquille SYNCHRONE (streaming Suspense) : la page retourne immédiatement le
// <Suspense> + skeleton, SANS aucun await en tête (ni session, ni
// searchParams — donnée de requête). Les deux sont lus DANS le flux
// (CommandesGate) pour que le shell /compte reste rendu tout de suite (Suspense) ;
// le fetch orders+count reste streamé.
export default function CommandesPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  return (
    <Suspense fallback={<ListSkeleton rows={5} />}>
      <CommandesGate searchParamsPromise={props.searchParams} />
    </Suspense>
  );
}

async function CommandesGate({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<SearchParams>;
}) {
  const searchParams = await searchParamsPromise;
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  return <CommandesContent userId={session.id} searchParams={searchParams} />;
}

async function CommandesContent({
  userId,
  searchParams,
}: {
  userId: string;
  searchParams: SearchParams;
}) {
  const admin = createSupabaseAdminClient();
  const cursor = parseCursor(searchParamsToUrlSearchParams(searchParams));

  // Audit perf-postgres-2026-05-05 M-2 + NEW-1 : pagination cursor
  // (created_at DESC + id DESC tie-breaker), .limit(100), couplée à un
  // count(*) exact parallélisé pour le banner ListingHeader.
  const itemsQuery = applyCursor(
    admin
      .from('orders')
      .select(`
        id, code_commande, producer_order_seq, created_at, statut, closure_reason, montant_total, producer_id,
        producers:producer_id ( nom_exploitation, slug, producer_number ),
        order_items ( id )
      `)
      .eq('consumer_id', userId),
    cursor,
  )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);

  const countQuery = admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('consumer_id', userId);

  const [itemsRes, countRes] = await Promise.all([itemsQuery, countQuery]);

  if (itemsRes.error) throw itemsRes.error;
  if (countRes.error) throw countRes.error;

  const data = itemsRes.data ?? [];

  const rows: OrderRow[] = data
    .map((o) => {
      const prod = Array.isArray(o.producers) ? o.producers[0] : o.producers;
      const itemsArr = Array.isArray(o.order_items) ? o.order_items : [];
      const producerNumber =
        (prod as { producer_number?: number } | null | undefined)?.producer_number ?? 0;
      const orderSeq = (o.producer_order_seq as number | null | undefined) ?? 0;
      return {
        id: o.id as string,
        code_commande: (o.code_commande as string | null) ?? null,
        numero_commande: formatOrderNumber(producerNumber, orderSeq),
        created_at: o.created_at as string,
        statut: o.statut as OrderStatus,
        closure_reason: (o.closure_reason as string | null) ?? null,
        montant_total: Number(o.montant_total ?? 0),
        producer_id: o.producer_id as string,
        producer_name: prod?.nom_exploitation ?? 'Producteur',
        producer_slug: prod?.slug ?? '',
        item_count: itemsArr.length,
      };
    })
    .filter((r) => !isVoidOrderRow(r));

  // Cursor basé sur le 100ème row brut (avant filter void), pour ne pas
  // sauter de rows lors de la page suivante.
  const last = data.length === 100 ? data[99] : null;
  const nextCursor = last
    ? { created_at: last.created_at as string, id: last.id as string }
    : null;

  const isPaginated = cursor.before !== null;

  return (
    <CommandesClient
      consumerId={userId}
      initialOrders={rows}
      initialTotal={countRes.count ?? 0}
      initialNextCursor={nextCursor}
      isPaginated={isPaginated}
    />
  );
}

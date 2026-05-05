import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchProducerForUser } from '@/lib/producers/context';
import { applyCursor, parseCursor } from '@/lib/pagination/cursor';
import {
  formatSlotRange,
  formatLegacyTimeHHMM,
} from '@/lib/slots/format-slot-time';
import type { OrderStatus } from '@/components/ui';
import {
  ProducerCommandesClient,
  type ProducerOrderRow,
} from './ProducerCommandesClient';

// Server Component — audit Vercel C-4 + H-5 (2026-05-05).
// Avant : 'use client' + auth.getUser() + producers lookup + orders fetch
// au mount. Maintenant : pattern coquille SSR (cf. dashboard/page.tsx) avec
// admin client + filter explicite par producer_id (cohérence brief Phase 3).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SearchParams = Record<string, string | string[] | undefined>;

function searchParamsToUrlSearchParams(sp: SearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') out.set(k, v);
  }
  return out;
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export default async function ProducerCommandesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  // (producer)/layout.tsx vérifie déjà session + host. Le lookup producer
  // utilise le client serveur (RLS owner read autorise auth.uid() = user_id).
  const supabase = createSupabaseServerClient();
  const producer = await fetchProducerForUser(supabase, session.id);
  if (!producer) redirect('/invitation');

  const admin = createSupabaseAdminClient();
  const cursor = parseCursor(searchParamsToUrlSearchParams(searchParams));

  // Audit perf-postgres-2026-05-05 M-2 + NEW-1 : pagination cursor
  // (created_at DESC + id DESC tie-breaker), .limit(100), couplée à un
  // count(*) exact parallélisé pour le banner ListingHeader.
  const itemsQuery = applyCursor(
    admin
      .from('orders')
      .select(`
        id, code_commande, created_at, statut, montant_total,
        date_retrait, heure_retrait,
        consumer:consumer_id ( prenom, nom ),
        slots:slot_id ( starts_at, ends_at ),
        order_items ( quantite, products:product_id ( nom, unite ) )
      `)
      .eq('producer_id', producer.id),
    cursor,
  )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(100);

  const countQuery = admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('producer_id', producer.id);

  const [itemsRes, countRes] = await Promise.all([itemsQuery, countQuery]);

  if (itemsRes.error) throw itemsRes.error;
  if (countRes.error) throw countRes.error;

  const data = itemsRes.data ?? [];

  const rows: ProducerOrderRow[] = (data as unknown as Array<{
    id: string;
    code_commande: string | null;
    created_at: string;
    statut: OrderStatus;
    montant_total: number | null;
    date_retrait: string | null;
    heure_retrait: string | null;
    consumer: { prenom: string | null; nom: string | null } | Array<{ prenom: string | null; nom: string | null }> | null;
    slots: { starts_at: string | null; ends_at: string | null } | Array<{ starts_at: string | null; ends_at: string | null }> | null;
    order_items: Array<{ quantite: number; products: { nom: string; unite: string } | Array<{ nom: string; unite: string }> | null }>;
  }>).map((o) => {
    const consumer = Array.isArray(o.consumer) ? o.consumer[0] : o.consumer;
    const slot = Array.isArray(o.slots) ? o.slots[0] : o.slots;
    const clientName = consumer?.prenom?.trim() || consumer?.nom?.trim() || 'Client';
    const items = (o.order_items ?? []).map((it) => {
      const p = Array.isArray(it.products) ? it.products[0] : it.products;
      const q = Number(it.quantite).toFixed(2).replace('.', ',');
      return {
        name: p?.nom ?? 'Produit',
        qty: `${q} ${p?.unite ?? ''}`.trim(),
      };
    });
    return {
      id: o.id,
      code_commande: o.code_commande,
      created_at: o.created_at,
      status: o.statut,
      client_name: clientName,
      total: Number(o.montant_total ?? 0),
      items,
      slotDate: formatDateShort(o.date_retrait),
      slotTime: slot?.starts_at && slot?.ends_at
        ? formatSlotRange(slot.starts_at, slot.ends_at)
        : formatLegacyTimeHHMM(o.heure_retrait),
    };
  });

  const last = data.length === 100 ? (data[99] as { id: string; created_at: string }) : null;
  const nextCursor = last
    ? { created_at: last.created_at, id: last.id }
    : null;

  const isPaginated = cursor.before !== null;

  return (
    <ProducerCommandesClient
      initialOrders={rows}
      initialTotal={countRes.count ?? 0}
      initialNextCursor={nextCursor}
      isPaginated={isPaginated}
    />
  );
}

import { notFound, redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import {
  formatSlotRange,
  formatLegacyTimeHHMM,
} from '@/lib/slots/format-slot-time';
import type { OrderStatus } from '@/components/ui';
import { OrderDetailClient, type OrderDetailData } from './OrderDetailClient';

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatQty(qty: number, unite: string | null): string {
  const q = Number(qty).toFixed(2).replace('.', ',');
  return `${q} ${unite ?? ''}`.trim();
}

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = createSupabaseServerClient();

  const { data: order } = await supabase
    .from('orders')
    .select(`
      id, code_commande, consumer_id, producer_id, statut, created_at,
      date_retrait, heure_retrait, montant_total,
      producers:producer_id ( nom_exploitation, slug, adresse, commune, code_postal, latitude, longitude ),
      slots:slot_id ( starts_at, ends_at ),
      order_items ( quantite, sous_total, products:product_id ( nom, unite ) )
    `)
    .eq('id', params.id)
    .maybeSingle();

  if (!order) notFound();
  if (order.consumer_id !== session.id) redirect('/compte/commandes');

  const { data: review } = await supabase
    .from('reviews')
    .select('id')
    .eq('order_id', order.id)
    .maybeSingle();

  const producerRow = Array.isArray(order.producers) ? order.producers[0] : order.producers;
  const slotRow = Array.isArray(order.slots) ? order.slots[0] : order.slots;

  const address = [producerRow?.adresse, producerRow?.code_postal, producerRow?.commune].filter(Boolean).join(', ');
  const slotTyped = slotRow as { starts_at: string | null; ends_at: string | null } | null;
  const timeLabel = slotTyped?.starts_at && slotTyped?.ends_at
    ? formatSlotRange(slotTyped.starts_at, slotTyped.ends_at)
    : formatLegacyTimeHHMM(order.heure_retrait);

  const items = ((order.order_items as unknown as Array<{
    quantite: number;
    sous_total: number;
    products: { nom: string; unite: string | null } | Array<{ nom: string; unite: string | null }>;
  }>) ?? []).map((oi) => {
    const prod = Array.isArray(oi.products) ? oi.products[0] : oi.products;
    return {
      name: prod?.nom ?? 'Produit',
      qty: formatQty(oi.quantite, prod?.unite ?? null),
      price: Number(oi.sous_total),
    };
  });

  const data: OrderDetailData = {
    id: order.id,
    codeCommande: order.code_commande ?? null,
    statut: order.statut as OrderStatus,
    createdAt: formatDateTimeLabel(order.created_at),
    total: Number(order.montant_total ?? 0),
    items,
    producer: {
      name: producerRow?.nom_exploitation ?? 'Producteur',
      slug: producerRow?.slug ?? '',
      address: address || '—',
      lat: producerRow?.latitude ?? null,
      lng: producerRow?.longitude ?? null,
    },
    slot: {
      dateLabel: order.date_retrait ? formatDateLabel(order.date_retrait) : '—',
      timeLabel,
    },
    hasReview: !!review,
  };

  return <OrderDetailClient data={data} />;
}

import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchProducerForUser } from '@/lib/producers/context';
import {
  formatSlotRange,
  formatLegacyTimeHHMM,
} from '@/lib/slots/format-slot-time';
import type { OrderStatus } from '@/components/ui';
import { formatOrderNumber } from '@/lib/orders/order-number';
import { OrderDetailClient, type OrderDetailData } from './OrderDetailClient';

function formatReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ' Ã  ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(iso: string | null): string {
  if (!iso) return 'â€”';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function ProducerOrderDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = await createSupabaseServerClient();
  const producer = await fetchProducerForUser(supabase, session.id);
  if (!producer) redirect('/invitation');

  const admin = createSupabaseAdminClient();

  const { data: order } = await admin
    .from('orders')
    .select(`
      id, producer_order_seq, producer_id, created_at, statut, notes_client,
      date_retrait, heure_retrait, montant_total, commission_terroir,
      consumer:consumer_id ( prenom, nom, email, telephone ),
      slots:slot_id ( starts_at, ends_at ),
      order_items ( quantite, prix_unitaire, sous_total, products:product_id ( nom, unite ) )
    `)
    .eq('id', params.id)
    .maybeSingle();

  if (!order) notFound();
  if (order.producer_id !== producer.id) redirect('/commandes');

  const consumer = Array.isArray(order.consumer) ? order.consumer[0] : order.consumer;
  const slot = Array.isArray(order.slots) ? order.slots[0] : order.slots;

  const clientName = [consumer?.prenom, consumer?.nom].filter(Boolean).join(' ').trim() || 'Client';

  const items = ((order.order_items as unknown as Array<{
    quantite: number;
    prix_unitaire: number;
    sous_total: number;
    products: { nom: string; unite: string | null } | Array<{ nom: string; unite: string | null }>;
  }>) ?? []).map((oi) => {
    const p = Array.isArray(oi.products) ? oi.products[0] : oi.products;
    const q = Number(oi.quantite).toFixed(2).replace('.', ',');
    return {
      name: p?.nom ?? 'Produit',
      qty: `${q} ${p?.unite ?? ''}`.trim(),
      unitPrice: Number(oi.prix_unitaire),
      total: Number(oi.sous_total),
    };
  });

  const subtotal = Number(order.montant_total ?? 0);
  const commission = Number(order.commission_terroir ?? subtotal * 0.06);

  const data: OrderDetailData = {
    id: order.id,
    numeroCommande: formatOrderNumber(producer.producer_number, order.producer_order_seq),
    client: {
      name: clientName,
      email: consumer?.email ?? 'â€”',
      phone: consumer?.telephone ?? 'â€”',
    },
    createdAtLabel: formatReceived(order.created_at),
    slotDate: formatDateLabel(order.date_retrait),
    slotTime: slot?.starts_at && slot?.ends_at
      ? formatSlotRange(slot.starts_at, slot.ends_at)
      : formatLegacyTimeHHMM(order.heure_retrait),
    items,
    subtotal,
    commission,
    total: subtotal,
    status: order.statut as OrderStatus,
    note: order.notes_client ?? undefined,
  };

  return <OrderDetailClient data={data} />;
}

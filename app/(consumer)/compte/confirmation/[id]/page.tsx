import { notFound, redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { ConfirmationClient } from './ConfirmationClient';

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTimeLabel(start: string, end: string | null): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(':');
    return m && m !== '00' ? `${parseInt(h, 10)}h${m}` : `${parseInt(h, 10)}h`;
  };
  if (!end) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

function isoDateTime(dateISO: string, time: string): string {
  const [h = '00', m = '00'] = (time ?? '00:00').split(':');
  return `${dateISO.replace(/-/g, '')}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
}

function formatQty(qty: number, unite: string | null): string {
  const q = Number(qty).toFixed(2).replace('.', ',');
  return `${q} ${unite ?? ''}`.trim();
}

export default async function ConfirmationPage({ params }: { params: { id: string } }) {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = createSupabaseServerClient();

  const { data: order } = await supabase
    .from('orders')
    .select(`
      id, code_commande, consumer_id, producer_id, slot_id,
      date_retrait, heure_retrait, montant_total, statut,
      producers:producer_id ( nom_exploitation, adresse, commune, code_postal ),
      slots:slot_id ( heure_debut, heure_fin ),
      order_items ( quantite, prix_unitaire, sous_total, products:product_id ( nom, unite ) )
    `)
    .eq('id', params.id)
    .maybeSingle();

  if (!order) notFound();
  if (order.consumer_id !== session.id) redirect('/compte/commandes');

  const producerRow = Array.isArray(order.producers) ? order.producers[0] : order.producers;
  const slotRow = Array.isArray(order.slots) ? order.slots[0] : order.slots;

  const address = [producerRow?.adresse, producerRow?.code_postal, producerRow?.commune].filter(Boolean).join(', ');
  const startTime = slotRow?.heure_debut ?? order.heure_retrait ?? '00:00';
  const endTime = slotRow?.heure_fin ?? null;

  const items = ((order.order_items as unknown as Array<{
    quantite: number;
    sous_total: number;
    prix_unitaire: number;
    products: { nom: string; unite: string | null } | Array<{ nom: string; unite: string | null }>;
  }>) ?? []).map((oi) => {
    const prod = Array.isArray(oi.products) ? oi.products[0] : oi.products;
    return {
      name: prod?.nom ?? 'Produit',
      qty: formatQty(oi.quantite, prod?.unite ?? null),
      price: Number(oi.sous_total),
    };
  });

  return (
    <ConfirmationClient
      orderId={order.id}
      codeCommande={order.code_commande ?? ''}
      items={items}
      producer={{ name: producerRow?.nom_exploitation ?? 'Producteur', address: address || '—' }}
      slot={{
        dateLabel: order.date_retrait ? formatDateLabel(order.date_retrait) : '—',
        timeLabel: formatTimeLabel(startTime, endTime),
        dateISO: order.date_retrait ?? '',
        startISO: order.date_retrait ? isoDateTime(order.date_retrait, startTime) : '',
        endISO: order.date_retrait && endTime ? isoDateTime(order.date_retrait, endTime) : '',
      }}
      total={Number(order.montant_total ?? 0)}
    />
  );
}

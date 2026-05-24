import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import {
  formatSlotRange,
  formatLegacyTimeHHMM,
} from '@/lib/slots/format-slot-time';
import type { OrderStatus } from '@/components/ui';
import { SectionSkeleton } from '../../_components/ContentSkeletons';
// T-217-bis (Cluster A) : la helper roundCoord reste importee comme filet
// applicatif, mais la lecture des coords passe desormais par la vue
// producers_public (verrou DB-level qui floute deja les valeurs a 2 decimales).
// Cf. supabase/migrations/20260507A00000_cluster_a_privacy_lat_lng.sql.
// PRIVACY: opt-out: lat/lng deja arrondies cote DB via vue producers_public,
// roundCoord reapplique pour fail-safe si la vue venait a etre regressee.
import { roundCoord } from '@/lib/producers/coords';
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

// Coquille SYNCHRONE (streaming Suspense) : la page retourne immédiatement le
// <Suspense> + skeleton, SANS aucun await en tête (ni session, ni params —
// donnée de requête). Tout l'accès dynamique vit dans OrderDetailGate, sous
// le <Suspense>.
export default function OrderDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<SectionSkeleton rows={4} />}>
      <OrderDetailGate paramsPromise={props.params} />
    </Suspense>
  );
}

async function OrderDetailGate(props: { paramsPromise: Promise<{ id: string }> }) {
  const params = await props.paramsPromise;
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const supabase = await createSupabaseServerClient();

  // T-217-bis (Cluster A) : on detache la lecture producer du embed orders
  // pour passer par la vue producers_public (lat/lng deja floutees DB-level).
  // L'embed sur orders ne peut pas pointer une vue PostgREST â€” fetch separe.
  const { data: order } = await supabase
    .from('orders')
    .select(`
      id, code_commande, consumer_id, producer_id, statut, created_at,
      date_retrait, heure_retrait, montant_total,
      slots:slot_id ( starts_at, ends_at ),
      order_items ( quantite, sous_total, products:product_id ( nom, unite ) )
    `)
    .eq('id', params.id)
    .maybeSingle();

  if (!order) notFound();
  if (order.consumer_id !== session.id) redirect('/compte/commandes');

  // Lecture producer via la vue producers_public â€” les coords sont deja
  // arrondies a 2 decimales (filtre statut='public' AND deleted_at IS NULL
  // dans le body de la vue).
  const { data: producerRow } = await supabase
    .from('producers_public')
    .select('nom_exploitation, slug, adresse, commune, code_postal, latitude, longitude')
    .eq('id', order.producer_id)
    .maybeSingle();

  const { data: review } = await supabase
    .from('reviews')
    .select('id')
    .eq('order_id', order.id)
    .maybeSingle();

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
      address: address || 'â€”',
      // T-217-bis : coords deja arrondies a 2 decimales par la vue
      // producers_public (verrou DB-level). roundCoord reapplique pour
      // fail-safe en cas de regression future de la vue.
      lat: roundCoord(producerRow?.latitude ?? null),
      lng: roundCoord(producerRow?.longitude ?? null),
    },
    slot: {
      dateLabel: order.date_retrait ? formatDateLabel(order.date_retrait) : 'â€”',
      timeLabel,
    },
    hasReview: !!review,
  };

  return <OrderDetailClient data={data} />;
}

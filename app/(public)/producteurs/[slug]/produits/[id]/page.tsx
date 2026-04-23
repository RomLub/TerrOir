import { notFound } from 'next/navigation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { generateSlotsForProducer } from '@/lib/slots/generate';
import { fetchPublicProducerBySlug } from '@/lib/producers/fetch-public';
import {
  ProductPageClient,
  type ProducerSummary,
  type ProductDetail,
  type SlotOption,
  type OtherProduct,
} from './ProductPageClient';

// Rendu dynamique à chaque requête : la page fetch des données qui évoluent
// (stock produit, slots générés depuis slot_rules, autres produits du
// producteur). Sans ça, Next.js peut cacher silencieusement le résultat
// SSR entre deux deploys et les nouveaux slots/produits n'apparaissent
// qu'après redeploy.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HORIZON_DAYS = 90;

function weightStepFor(unit: string | null): number {
  if (unit === 'kg') return 0.25;
  return 1;
}

export default async function ProductPage({ params }: { params: { slug: string; id: string } }) {
  const admin = createSupabaseAdminClient();

  const { data: productRow } = await admin
    .from('products')
    .select('id, nom, description, photos, prix, unite, poids_estime_kg, stock_disponible, stock_illimite, delai_preparation_jours, active, producer_id, conseil_active, conseil_texte')
    .eq('id', params.id)
    .eq('active', true)
    .maybeSingle();

  if (!productRow) notFound();

  // Fetch producer par slug (canonique depuis l'URL) via le helper public,
  // puis cross-check que le product.producer_id matche. Garanties identiques
  // à l'ancien flow : statut='public', deleted_at IS NULL, et cohérence
  // slug↔product.
  const producerRow = await fetchPublicProducerBySlug(admin, params.slug);
  if (!producerRow || producerRow.id !== productRow.producer_id) notFound();

  // Matérialise les slots depuis les slot_rules actives. Idempotent
  // (UPSERT onConflict producer_id,starts_at ignoreDuplicates) + mémo
  // 15 min côté helper. Fail-open : si le générateur échoue, on affiche
  // les slots déjà en DB plutôt que de casser la page.
  try {
    await generateSlotsForProducer(admin, producerRow.id, HORIZON_DAYS);
  } catch (e) {
    console.warn('SLOTS_GENERATE_WARN', e);
  }

  // Préserve l'ancien comportement de delai_preparation_jours :
  // nextOccurrenceISO() poussait la première date visible de N jours.
  // Ici on filtre directement à la lecture.
  const delai = productRow.delai_preparation_jours ?? 0;
  const now = new Date();
  const earliest = new Date(now.getTime() + delai * 24 * 3600 * 1000);
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 3600 * 1000);

  const [{ data: slotsRaw }, { data: otherRaw }, { data: bookingsRaw }] =
    await Promise.all([
      admin
        .from('slots')
        .select('id, starts_at, ends_at, capacity_per_slot')
        .eq('producer_id', producerRow.id)
        .eq('active', true)
        .is('excluded_at', null)
        .gte('starts_at', earliest.toISOString())
        .lt('starts_at', horizonEnd.toISOString())
        .order('starts_at', { ascending: true }),
      admin
        .from('products')
        .select('id, nom, photos, prix, unite, stock_disponible, stock_illimite')
        .eq('producer_id', producerRow.id)
        .eq('active', true)
        .neq('id', params.id)
        .limit(3),
      // Phase 6b : comptage des orders actives par slot pour dériver la
      // capacité restante (SlotOption.left). Bornée aux statuts actifs
      // (pending/confirmed/ready) → les orders completed/cancelled/refunded
      // libèrent leur slot dans le décompte consumer. Le check autoritatif
      // reste côté RPC create_order_with_items (SELECT FOR UPDATE +
      // recount), ce fetch sert uniquement à griser les slots pleins en UI.
      admin
        .from('orders')
        .select('slot_id')
        .eq('producer_id', producerRow.id)
        .in('statut', ['pending', 'confirmed', 'ready']),
    ]);

  const bookingCounts = new Map<string, number>();
  for (const b of (bookingsRaw ?? []) as { slot_id: string | null }[]) {
    if (!b.slot_id) continue;
    bookingCounts.set(b.slot_id, (bookingCounts.get(b.slot_id) ?? 0) + 1);
  }

  const commune = [producerRow.commune, producerRow.code_postal].filter(Boolean).join(' · ');
  const address = [producerRow.adresse, producerRow.code_postal, producerRow.commune]
    .filter(Boolean)
    .join(' · ');

  const producer: ProducerSummary = {
    id: producerRow.id,
    slug: producerRow.slug,
    name: producerRow.nom_exploitation,
    firstName: producerRow.prenom_affichage,
    commune: commune || '—',
    address: address || '—',
    lat: producerRow.latitude,
    lng: producerRow.longitude,
  };

  const descParas = (productRow.description ?? '')
    .split(/\n{2,}/)
    .map((p: string) => p.trim())
    .filter(Boolean);

  const product: ProductDetail = {
    id: productRow.id,
    name: productRow.nom,
    price: Number(productRow.prix),
    unit: productRow.unite ?? 'kg',
    weightStep: weightStepFor(productRow.unite),
    stockLeft: productRow.stock_illimite ? 999 : (productRow.stock_disponible ?? 0),
    stockUnlimited: !!productRow.stock_illimite,
    delaiJours: productRow.delai_preparation_jours ?? 0,
    photos: Array.isArray(productRow.photos) ? productRow.photos : [],
    description: descParas,
    conseil: {
      active: !!productRow.conseil_active,
      texte: (productRow.conseil_texte as string | null) ?? null,
    },
  };

  const slots: SlotOption[] = (slotsRaw ?? []).map((s) => ({
    id: s.id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    capacity_per_slot: s.capacity_per_slot,
    left: Math.max(0, s.capacity_per_slot - (bookingCounts.get(s.id) ?? 0)),
  }));

  const otherProducts: OtherProduct[] = (otherRaw ?? []).map((p) => ({
    id: p.id,
    name: p.nom,
    price: Number(p.prix),
    unit: p.unite ?? 'kg',
    stockLeft: p.stock_illimite ? 999 : (p.stock_disponible ?? 0),
    producer: producerRow.nom_exploitation,
    image: Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null,
  }));

  return (
    <ProductPageClient
      producer={producer}
      product={product}
      slots={slots}
      otherProducts={otherProducts}
    />
  );
}

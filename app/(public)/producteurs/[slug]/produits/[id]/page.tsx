import { notFound } from 'next/navigation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { generateSlotsForProducer } from '@/lib/slots/generate';
import {
  ProductPageClient,
  type ProducerSummary,
  type ProductDetail,
  type SlotOption,
  type OtherProduct,
} from './ProductPageClient';

const HORIZON_DAYS = 90;

function weightStepFor(unit: string | null): number {
  if (unit === 'kg') return 0.25;
  return 1;
}

export default async function ProductPage({ params }: { params: { slug: string; id: string } }) {
  const admin = createSupabaseAdminClient();

  const { data: productRow } = await admin
    .from('products')
    .select('id, nom, description, photos, prix, unite, poids_estime_kg, stock_disponible, stock_illimite, delai_preparation_jours, actif, producer_id')
    .eq('id', params.id)
    .eq('actif', true)
    .maybeSingle();

  if (!productRow) notFound();

  const { data: producerRow } = await admin
    .from('producers')
    .select('id, slug, nom_exploitation, commune, code_postal, adresse, latitude, longitude')
    .eq('id', productRow.producer_id)
    .eq('statut', 'public')
    .maybeSingle();

  if (!producerRow || producerRow.slug !== params.slug) notFound();

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

  const [{ data: slotsRaw }, { data: otherRaw }] = await Promise.all([
    admin
      .from('slots')
      .select('id, starts_at, ends_at, capacity_per_slot')
      .eq('producer_id', producerRow.id)
      .eq('actif', true)
      .gte('starts_at', earliest.toISOString())
      .lt('starts_at', horizonEnd.toISOString())
      .order('starts_at', { ascending: true }),
    admin
      .from('products')
      .select('id, nom, photos, prix, unite, stock_disponible, stock_illimite')
      .eq('producer_id', producerRow.id)
      .eq('actif', true)
      .neq('id', params.id)
      .limit(3),
  ]);

  const commune = [producerRow.commune, producerRow.code_postal].filter(Boolean).join(' · ');
  const address = [producerRow.adresse, producerRow.code_postal, producerRow.commune]
    .filter(Boolean)
    .join(' · ');

  const producer: ProducerSummary = {
    id: producerRow.id,
    slug: producerRow.slug,
    name: producerRow.nom_exploitation,
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
  };

  const slots: SlotOption[] = (slotsRaw ?? []).map((s) => ({
    id: s.id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    capacity_per_slot: s.capacity_per_slot,
    // Phase 6 câblera la capacité restante via count(orders actives).
    left: null,
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

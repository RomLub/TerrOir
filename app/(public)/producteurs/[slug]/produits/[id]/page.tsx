import { notFound } from 'next/navigation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  ProductPageClient,
  type ProducerSummary,
  type ProductDetail,
  type SlotOption,
  type OtherProduct,
} from './ProductPageClient';

function weightStepFor(unit: string | null): number {
  if (unit === 'kg') return 0.25;
  return 1;
}

function formatTime(t: string): string {
  const [h, m] = t.split(':');
  if (!h) return t;
  const hi = parseInt(h, 10);
  return m && m !== '00' ? `${hi}h${m}` : `${hi}h`;
}

function nextOccurrenceISO(dayOfWeek: number, minDaysAhead: number): string {
  const now = new Date();
  const target = new Date(now);
  target.setDate(now.getDate() + Math.max(0, minDaysAhead));
  const diff = (7 + dayOfWeek - target.getDay()) % 7;
  target.setDate(target.getDate() + diff);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

  const [{ data: slotsRaw }, { data: otherRaw }] = await Promise.all([
    admin
      .from('slots')
      .select('id, jour_semaine, heure_debut, heure_fin, actif')
      .eq('producer_id', producerRow.id)
      .eq('actif', true)
      .order('jour_semaine', { ascending: true })
      .order('heure_debut', { ascending: true }),
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

  const delai = productRow.delai_preparation_jours ?? 0;
  const slots: SlotOption[] = (slotsRaw ?? []).map((s) => {
    const dateISO = nextOccurrenceISO(s.jour_semaine, delai);
    const d = new Date(dateISO + 'T00:00:00');
    const human = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return {
      id: s.id,
      label: human.charAt(0).toUpperCase() + human.slice(1),
      time: `${formatTime(s.heure_debut)} – ${formatTime(s.heure_fin)}`,
      left: null,
      dateISO,
    };
  });

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

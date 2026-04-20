import { notFound } from 'next/navigation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { labelEspece, labelLabel } from '@/lib/producers/labels';
import {
  ProducerPageClient,
  type ProducerData,
  type ProductData,
  type ReviewData,
} from './ProducerPageClient';

const REVIEWS_FETCH_LIMIT = 50;

function scoreFromBadge(v: number | null | undefined): number {
  if (v === null || v === undefined || Number.isNaN(v)) return 0;
  return Math.round(v);
}

function formatDateFr(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function firstNameFrom(user: { prenom: string | null; nom: string | null } | null): string {
  if (!user) return 'Anonyme';
  if (user.prenom && user.prenom.trim()) return user.prenom.trim();
  if (user.nom && user.nom.trim()) return user.nom.trim().split(' ')[0];
  return 'Anonyme';
}

export default async function ProducteurPage({ params }: { params: { slug: string } }) {
  const admin = createSupabaseAdminClient();

  const { data: producer } = await admin
    .from('producers')
    .select('id, slug, nom_exploitation, commune, code_postal, photo_principale, photos, description, histoire, annee_creation, generations, especes, labels, badge_stock_score, badge_confirmation_score, badge_annulation_score, note_moyenne, nb_avis')
    .eq('slug', params.slug)
    .eq('statut', 'active')
    .maybeSingle();

  if (!producer) {
    notFound();
  }

  const [{ data: productsRaw }, { data: reviewsRaw }] = await Promise.all([
    admin
      .from('products')
      .select('id, nom, description, photos, prix, unite, stock_disponible, stock_illimite')
      .eq('producer_id', producer.id)
      .eq('actif', true)
      .order('created_at', { ascending: false }),
    admin
      .from('reviews')
      .select('note, commentaire, created_at, users:consumer_id ( prenom, nom )')
      .eq('producer_id', producer.id)
      .eq('statut', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(REVIEWS_FETCH_LIMIT),
  ]);

  const commune = [producer.commune, producer.code_postal].filter(Boolean).join(' · ');

  const storyParts = [producer.histoire, producer.description]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .flatMap((s) => s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));

  const producerData: ProducerData = {
    slug: producer.slug,
    name: producer.nom_exploitation,
    commune: commune || '—',
    heroPhoto: producer.photo_principale ?? null,
    gallery: (producer.photos ?? []).slice(0, 6),
    scores: {
      stock: scoreFromBadge(producer.badge_stock_score),
      response: scoreFromBadge(producer.badge_confirmation_score),
      reliability: scoreFromBadge(producer.badge_annulation_score),
    },
    species: (producer.especes ?? []).map(labelEspece),
    labels: (producer.labels ?? []).map(labelLabel),
    generations: producer.generations,
    anneeCreation: producer.annee_creation,
    rating: Number(producer.note_moyenne ?? 0),
    reviewCount: producer.nb_avis ?? 0,
    story: storyParts,
  };

  const productName = producer.nom_exploitation;
  const products: ProductData[] = (productsRaw ?? []).map((p) => ({
    id: p.id,
    name: p.nom,
    price: Number(p.prix),
    unit: p.unite ?? 'kg',
    stockLeft: p.stock_illimite ? 999 : (p.stock_disponible ?? 0),
    image: Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null,
    producer: productName,
  }));

  const reviews: ReviewData[] = (reviewsRaw ?? []).map((r) => {
    const user = Array.isArray(r.users) ? r.users[0] ?? null : r.users ?? null;
    return {
      firstName: firstNameFrom(user),
      date: formatDateFr(r.created_at as string),
      rating: r.note ?? 0,
      text: r.commentaire ?? '',
    };
  });

  return <ProducerPageClient producer={producerData} products={products} reviews={reviews} />;
}

import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { labelEspece, labelLabel } from '@/lib/producers/labels';
import { STOCK_UNLIMITED_SENTINEL } from '@/lib/products/constants';
import {
  fetchPublicProducerBySlug,
  type ProducerPublic,
} from '@/lib/producers/fetch-public';
import {
  ProducerPageClient,
  type ProducerData,
  type ProductData,
  type ReviewData,
} from './ProducerPageClient';

// Audit Vercel C-5 (2026-05-05) : conserve force-dynamic au niveau page
// (produits + reviews évoluent en temps réel), MAIS partial-cache le bloc
// producer (header, photos, badges) via unstable_cache
// avec un tag par slug. Le bloc producer change rarement (édition manuelle
// depuis ma-page) ; pas la peine de re-fetch à chaque visite. Invalidation
// explicite via revalidateProducerCard({slug}) côté ma-page après save.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PRODUCER_BLOCK_REVALIDATE_S = 60;

// Wrapping unstable_cache + tag par slug. Clé inclut le slug pour isoler
// les entrées par producer. Invalidation : revalidateTag(`producer:${slug}`)
// (helper revalidateProducerCard dans lib/stats/revalidate).
async function fetchCachedProducerBlock(slug: string): Promise<ProducerPublic | null> {
  return unstable_cache(
    async () => {
      const admin = createSupabaseAdminClient();
      return fetchPublicProducerBySlug(admin, slug);
    },
    ['producer-block', slug],
    {
      revalidate: PRODUCER_BLOCK_REVALIDATE_S,
      tags: [`producer:${slug}`],
    },
  )();
}

const REVIEWS_FETCH_LIMIT = 50;
const REVIEWS_REVALIDATE_S = 30;
const PRODUCTS_REVALIDATE_S = 30;

// F-047 (audit pré-launch 2026-05) — Partial caching reviews + products
// sur la fiche /producteurs/[slug]. Tag par slug pour invalidation ciblée
// quand un producteur reçoit une nouvelle review (consumer review submit
// + producer response respond) ou modifie son catalogue (create/update/
// toggle actif catalogue). TTL court (30s) car ces deux blocs évoluent
// plus vite que le bloc producer (60s).
//
// Le retour est conservé en shape Raw (PostgREST) — la projection
// applicative se fait après le cache pour ne pas réinventer les Maps de
// transformation côté unstable_cache.

type ReviewRaw = {
  note: number | null;
  commentaire: string | null;
  created_at: string;
  producer_response: string | null;
  producer_response_at: string | null;
  users: { prenom: string | null; nom: string | null } | { prenom: string | null; nom: string | null }[] | null;
};

type ProductRaw = {
  id: string;
  nom: string;
  description: string | null;
  photos: string[] | null;
  prix: number | string;
  unite: string | null;
  stock_disponible: number | null;
  stock_illimite: boolean | null;
};

async function fetchCachedProducerReviews(producerId: string, slug: string): Promise<ReviewRaw[]> {
  return unstable_cache(
    async () => {
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from('reviews')
        .select(
          'note, commentaire, created_at, producer_response, producer_response_at, users:consumer_id ( prenom, nom )',
        )
        .eq('producer_id', producerId)
        .eq('statut', 'published')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(REVIEWS_FETCH_LIMIT);
      return (data ?? []) as unknown as ReviewRaw[];
    },
    ['producer-reviews', slug],
    {
      revalidate: REVIEWS_REVALIDATE_S,
      tags: [`producer-reviews:${slug}`],
    },
  )();
}

async function fetchCachedProducerProducts(producerId: string, slug: string): Promise<ProductRaw[]> {
  return unstable_cache(
    async () => {
      const admin = createSupabaseAdminClient();
      const { data } = await admin
        .from('products')
        .select('id, nom, description, photos, prix, unite, stock_disponible, stock_illimite')
        .eq('producer_id', producerId)
        .eq('active', true)
        .order('created_at', { ascending: false });
      return (data ?? []) as unknown as ProductRaw[];
    },
    ['producer-products', slug],
    {
      revalidate: PRODUCTS_REVALIDATE_S,
      tags: [`producer-products:${slug}`],
    },
  )();
}

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

export default async function ProducteurPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  // Bloc producer cached (60s + tag par slug). Produits/reviews fetch
  // direct via admin client en parallèle (force-dynamic pour ces deux).
  const producer = await fetchCachedProducerBlock(params.slug);

  if (!producer) {
    notFound();
  }

  // F-047 : reviews + products cachés par slug avec invalidation tag-based
  // (revalidateProducerReviews / revalidateProducerProducts depuis les flows
  // qui modifient ces blocs).
  const [productsRaw, reviewsRaw] = await Promise.all([
    fetchCachedProducerProducts(producer.id, producer.slug),
    fetchCachedProducerReviews(producer.id, producer.slug),
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
    bio: producer.bio,
    generations: producer.generations,
    anneeCreation: producer.annee_creation,
    rating: Number(producer.note_moyenne ?? 0),
    reviewCount: producer.nb_avis ?? 0,
    story: storyParts,
    latitude: producer.latitude,
    longitude: producer.longitude,
  };

  const productName = producer.nom_exploitation;
  const products: ProductData[] = (productsRaw ?? []).map((p) => ({
    id: p.id,
    name: p.nom,
    price: Number(p.prix),
    unit: p.unite ?? 'kg',
    stockLeft: p.stock_illimite ? STOCK_UNLIMITED_SENTINEL : (p.stock_disponible ?? 0),
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
      producerResponse: (r as { producer_response: string | null }).producer_response ?? null,
      producerResponseDate: (r as { producer_response_at: string | null }).producer_response_at
        ? formatDateFr((r as { producer_response_at: string }).producer_response_at)
        : null,
    };
  });

  return <ProducerPageClient producer={producerData} products={products} reviews={reviews} />;
}

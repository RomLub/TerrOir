'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Button,
  Badge,
  ProducerBadge,
  ProductCard,
  StarRating,
} from '@/components/ui';
import type {
  Alimentation,
  DensiteAnimale,
  ModeElevage,
} from '@/lib/producers/score-carbone-enums';
import { ScoreCarbonBlock } from './_components/ScoreCarbonBlock';

// Visuel de secours hero tant que le producteur n'a pas uploadé sa propre
// photo — champ moissonné Sarthe (PR3 audit photos 2026-05-17 : remplace
// l'URL Unsplash hardcodée par un asset local en format hero-16x9). On
// utilise photo13 ici, PAS photo06, pour éviter le doublon visuel avec
// le hero home consumer.
const DEFAULT_HERO_PHOTO =
  '/images/editorial/photo13_champ-cielbleu_hero-16x9.jpg';
// PR3 audit photos 2026-05-17 : l'ancien fallback PRODUCT_PHOTOS
// (3 URLs Unsplash beef/pork/lamb + heuristique regex pickProductImage)
// a été retiré. Le fallback est désormais géré par <ProductFallback />
// (terra-100 + icône catégorie SVG inline) directement dans ProductCard
// quand `image` est null. Granularité catégorie seule — la distinction
// beef/pork/lamb par regex sur le nom du produit n'existe plus.

export type ProducerData = {
  slug: string;
  name: string;
  commune: string;
  heroPhoto: string | null;
  gallery: (string | null)[];
  scores: { stock: number; response: number; reliability: number };
  species: string[];
  labels: string[];
  generations: number | null;
  anneeCreation: number | null;
  rating: number;
  reviewCount: number;
  story: string[];
  modeElevage: ModeElevage | null;
  alimentation: Alimentation | null;
  densiteAnimale: DensiteAnimale | null;
  latitude: number | null;
  longitude: number | null;
};

export type ProductData = {
  id: string;
  name: string;
  price: number;
  unit: string;
  stockLeft: number;
  category?: string;
  image?: string | null;
  producer: string;
};

export type ReviewData = {
  firstName: string;
  date: string;
  rating: number;
  text: string;
  // Réponse producer (CGU 6.4). Affichée si présente et status=published.
  // Si removed_admin/removed_producer, on n'affiche rien (la colonne
  // producer_response est NULL dans ces cas — cf. migration).
  producerResponse: string | null;
  producerResponseDate: string | null;
};

const REVIEWS_PER_PAGE = 10;

export function ProducerPageClient({
  producer,
  products,
  reviews,
}: {
  producer: ProducerData;
  products: ProductData[];
  reviews: ReviewData[];
}) {
  const [page, setPage] = useState(1);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const visibleReviews = reviews.slice(0, page * REVIEWS_PER_PAGE);
  const canLoadMore = reviews.length > visibleReviews.length;

  const heroPhoto = producer.heroPhoto ?? DEFAULT_HERO_PHOTO;

  const scrollToProducts = () => {
    document.getElementById('produits')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const yearsActive = producer.anneeCreation ? new Date().getFullYear() - producer.anneeCreation : null;

  return (
    <div className="min-h-screen bg-bg pb-24 lg:pb-0">
      <section className="relative h-[400px] overflow-hidden">
        <Image
          src={heroPhoto}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-t from-green-900/90 via-green-900/50 to-transparent" />
        <div className="relative max-w-7xl mx-auto px-6 h-full flex flex-col justify-end pb-8">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/carte" className="text-[12px] text-green-100/80 hover:text-white flex items-center gap-1.5">
              ← Retour à la carte
            </Link>
          </div>
          <h1 className="font-serif text-[44px] md:text-[64px] text-white leading-[1.02] tracking-tight">{producer.name}</h1>
          <p className="mt-1 text-[16px] text-green-100/90">{producer.commune}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ProducerBadge kind="stock" score={producer.scores.stock} />
            <ProducerBadge kind="response" score={producer.scores.response} />
            <ProducerBadge kind="reliability" score={producer.scores.reliability} />
          </div>
        </div>
      </section>

      <nav className={`sticky top-16 z-30 bg-bg/95 backdrop-blur border-b border-dark/[0.06] ${scrolled ? 'shadow-soft' : ''}`}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 overflow-x-auto">
            {['Histoire', 'Produits', 'Avis'].map((a) => (
              <a key={a} href={`#${a.toLowerCase()}`} className="px-3 h-9 inline-flex items-center rounded-lg text-[14px] font-medium text-dark/70 hover:text-green-900 hover:bg-green-100/60">
                {a}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[13px] whitespace-nowrap">
            <StarRating value={producer.rating} readOnly size="sm" />
            <span className="font-semibold text-green-900 tabular-nums">{producer.rating.toFixed(1)}</span>
            <span className="text-dark/60">· {producer.reviewCount} avis</span>
          </div>
        </div>
      </nav>

      <section id="histoire" className="max-w-7xl mx-auto px-6 py-16 md:py-24 scroll-mt-32">
        <div className="grid md:grid-cols-[5fr_6fr] gap-10 md:gap-16 items-start">
          <div>
            <PhotoPlaceholder label="Photo de famille devant la ferme" className="aspect-4/5 w-full rounded-2xl" />
            <div className="mt-6 grid grid-cols-3 gap-3">
              {producer.generations && <InfoKey stat={`${producer.generations}e`} label="génération" />}
              {yearsActive !== null && <InfoKey stat={`${yearsActive}+`} label="ans d'élevage" />}
              <InfoKey stat={`${products.length}`} label="produits" />
            </div>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Notre histoire</span>
            <h2 className="mt-2 font-serif text-[38px] md:text-[48px] text-green-900 leading-tight">Élever avec soin, livrer en direct.</h2>
            <div className="mt-6 space-y-4 text-[15px] text-dark/80 leading-relaxed max-w-xl">
              {producer.story.map((para, i) => <p key={i}>{para}</p>)}
            </div>
            <div className="mt-8">
              {producer.species.length > 0 && (
                <>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-dark/60 font-semibold mb-2">Espèces élevées</div>
                  <div className="flex flex-wrap gap-1.5 mb-4">{producer.species.map((s) => <Badge key={s}>{s}</Badge>)}</div>
                </>
              )}
              {producer.labels.length > 0 && (
                <>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-dark/60 font-semibold mb-2">Labels & certifications</div>
                  <div className="flex flex-wrap gap-1.5">{producer.labels.map((l) => <Badge key={l} variant="terra">{l}</Badge>)}</div>
                </>
              )}
            </div>
          </div>
        </div>

        {producer.gallery.length > 0 && (
          <div className="mt-14">
            <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold mb-4">La ferme en images</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {producer.gallery.map((photo, i) => (
                <div key={i} className={`relative rounded-xl overflow-hidden ${i === 0 ? 'md:row-span-2 md:col-span-2 aspect-4/3' : 'aspect-4/3'}`}>
                  {photo ? (
                    <Image
                      src={photo}
                      alt=""
                      fill
                      sizes={i === 0 ? '(min-width: 768px) 66vw, 100vw' : '(min-width: 768px) 33vw, 50vw'}
                      className="object-cover"
                    />
                  ) : (
                    <PhotoPlaceholder label={`Photo ${i + 1}`} className="w-full h-full" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section id="produits" className="bg-green-100/40 border-y border-dark/[0.04] scroll-mt-32">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Au catalogue</span>
              <h2 className="mt-2 font-serif text-[38px] md:text-[48px] text-green-900 leading-tight">Nos produits disponibles</h2>
            </div>
            <span className="text-[13px] text-dark/60 mono">{products.length} produit{products.length > 1 ? 's' : ''} actif{products.length > 1 ? 's' : ''}</span>
          </div>

          {products.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dark/[0.06] p-10 text-center">
              <h3 className="font-serif text-[22px] text-green-900">Revenez bientôt</h3>
              <p className="text-[14px] text-dark/60 mt-1 max-w-sm mx-auto">Aucun produit actif pour le moment.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {products.map((prod) => (
                <Link
                  key={prod.id}
                  href={`/producteurs/${producer.slug}/produits/${prod.id}`}
                  className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-700"
                >
                  <ProductCard product={prod} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <section id="avis" className="max-w-7xl mx-auto px-6 py-16 md:py-24 scroll-mt-32">
        <div className="grid md:grid-cols-[auto_1fr] gap-12 items-start">
          <div className="md:sticky md:top-36">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Avis clients</span>
            <div className="mt-3 font-serif text-[72px] text-green-900 leading-none tabular-nums">{producer.rating.toFixed(1)}</div>
            <StarRating value={producer.rating} readOnly size="lg" className="mt-2" />
            <div className="mt-2 text-[14px] text-dark/60">{producer.reviewCount} avis vérifiés</div>
          </div>

          <div className="space-y-4">
            {visibleReviews.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dark/[0.06] p-8 text-center">
                <p className="text-[14px] text-dark/60">Aucun avis pour le moment.</p>
              </div>
            ) : visibleReviews.map((r, i) => (
              <article key={i} className="bg-white rounded-2xl border border-dark/[0.06] p-6 shadow-soft">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-700 text-white flex items-center justify-center font-semibold">{r.firstName[0] ?? '?'}</div>
                    <div>
                      <div className="text-[14px] font-semibold text-dark">{r.firstName}</div>
                      <div className="text-[12px] text-dark/50">{r.date}</div>
                    </div>
                  </div>
                  <StarRating value={r.rating} readOnly size="sm" />
                </div>
                <p className="text-[14px] text-dark/80 leading-relaxed">{r.text}</p>
                {r.producerResponse && (
                  <div className="mt-4 ml-4 border-l-4 border-terroir-terracotta-500 pl-4 py-2 bg-terroir-bg/50 rounded-r">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-terroir-green-700 mb-1">
                      Réponse du producteur
                      {r.producerResponseDate && (
                        <span className="ml-2 font-normal normal-case tracking-normal text-dark/50">
                          · {r.producerResponseDate}
                        </span>
                      )}
                    </div>
                    <p className="text-[14px] text-dark/80 leading-relaxed">{r.producerResponse}</p>
                  </div>
                )}
              </article>
            ))}
            {canLoadMore && (
              <div className="text-center pt-4">
                <Button variant="secondary" onClick={() => setPage(page + 1)}>Voir plus d&apos;avis</Button>
              </div>
            )}
          </div>
        </div>
      </section>

      <ScoreCarbonBlock
        modeElevage={producer.modeElevage}
        alimentation={producer.alimentation}
        densiteAnimale={producer.densiteAnimale}
        producerLat={producer.latitude}
        producerLng={producer.longitude}
        producerName={producer.name}
      />

      <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-white border-t border-dark/[0.08] shadow-[0_-4px_16px_rgba(27,67,50,0.08)] p-3">
        <Button size="lg" className="w-full" onClick={scrollToProducts}>
          Commander chez {producer.name.split(' ').slice(-2).join(' ')} →
        </Button>
      </div>
    </div>
  );
}

function InfoKey({ stat, label }: { stat: string; label: string }) {
  return (
    <div className="bg-white rounded-xl border border-dark/[0.06] p-3 text-center">
      <div className="font-serif text-[28px] text-green-900 leading-none">{stat}</div>
      <div className="text-[11px] uppercase tracking-widest text-dark/60 mt-1">{label}</div>
    </div>
  );
}

function PhotoPlaceholder({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center text-green-900/30 font-mono text-[11px] tracking-wider uppercase ${className}`}
      style={{ backgroundImage: 'repeating-linear-gradient(45deg, #D8F3DC 0 14px, #C9EAD0 14px 28px)' }}
    >
      {label}
    </div>
  );
}

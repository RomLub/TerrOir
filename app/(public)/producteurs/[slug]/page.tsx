'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Badge,
  ProducerBadge,
  ProductCard,
  StarRating,
} from '@/components/ui';

// ---- Mock data (à remplacer par fetch server-side `params.slug`)
const PRODUCER = {
  slug: 'ferme-des-chenes',
  name: 'Ferme des Chênes',
  commune: "Parigné-l'Évêque · Sarthe",
  heroPhoto: null,
  familyPhoto: null,
  gallery: [null, null, null, null, null, null],
  scores: { stock: 98, response: 94, reliability: 100 },
  species: ['Bœuf Charolais', 'Agneau de pré'],
  labels: ['Label Rouge', 'Agriculture Biologique'],
  generations: 4,
  sizeHa: 42,
  since: 1978,
  rating: 4.8,
  reviewCount: 127,
  story: [
    "La Ferme des Chênes est installée au cœur de la vallée du Loir depuis 1978. Quatre générations de Durand s'y sont succédées, avec une même conviction : on élève mieux quand on élève moins.",
    "Nos 42 hectares de prairies naturelles accueillent un troupeau de bovins Charolais et un petit cheptel d'agneaux de pré. Ils paissent librement d'avril à novembre, et nous produisons nous-mêmes leur alimentation hivernale.",
    "Depuis 2018, l'ensemble de l'exploitation est certifié Agriculture Biologique. Une démarche exigeante mais cohérente avec ce que nous faisons depuis toujours.",
  ],
  products: [
    { id: 'roti', name: 'Rôti de bœuf Charolais', price: 24.9, unit: 'kg', stockLeft: 12, producer: 'Ferme des Chênes', category: 'Bœuf' },
    { id: 'entrecote', name: 'Entrecôte maturée 21 jours', price: 34.5, unit: 'kg', stockLeft: 5, producer: 'Ferme des Chênes', category: 'Bœuf' },
    { id: 'colis', name: 'Colis découverte 5kg', price: 89, unit: 'colis', stockLeft: 8, producer: 'Ferme des Chênes', category: 'Colis' },
    { id: 'gigot', name: "Gigot d'agneau de pré", price: 28.0, unit: 'kg', stockLeft: 3, producer: 'Ferme des Chênes', category: 'Agneau' },
    { id: 'merguez', name: 'Merguez maison', price: 18.5, unit: 'kg', stockLeft: 0, producer: 'Ferme des Chênes', category: 'Agneau' },
    { id: 'bourguignon', name: 'Bourguignon Charolais', price: 19.9, unit: 'kg', stockLeft: 22, producer: 'Ferme des Chênes', category: 'Bœuf' },
  ],
  reviews: [
    { firstName: 'Marie', date: '12 avril 2026', rating: 5, text: "Une viande d'exception, goûteuse comme on n'en trouve plus en grande surface. Pierre a pris le temps de tout nous expliquer au retrait. Merci !" },
    { firstName: 'Jean-Luc', date: '28 mars 2026', rating: 5, text: "Je commande régulièrement depuis six mois. Jamais déçu. La qualité est constante et le contact direct change tout." },
    { firstName: 'Sophie', date: '15 mars 2026', rating: 4, text: "Très bonne viande, produits frais. Un peu de mal à trouver la ferme la première fois mais c'est bien indiqué sur l'itinéraire envoyé." },
    { firstName: 'Antoine', date: '2 mars 2026', rating: 5, text: "Le bourguignon est tout simplement le meilleur que j'ai mangé. À recommander sans hésiter." },
    { firstName: 'Camille', date: '18 février 2026', rating: 5, text: "Colis découverte parfait pour un premier essai. On sent le travail et la passion derrière chaque morceau." },
  ],
};

const REVIEWS_PER_PAGE = 10;

export default function ProducteurPage({ params }: { params: { slug: string } }) {
  const [page, setPage] = useState(1);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const p = PRODUCER;
  const visibleReviews = p.reviews.slice(0, page * REVIEWS_PER_PAGE);
  const canLoadMore = p.reviews.length > visibleReviews.length;

  const scrollToProducts = () => {
    document.getElementById('produits')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-bg pb-24 lg:pb-0">
      {/* 1. HERO */}
      <section className="relative h-[400px] overflow-hidden">
        <PhotoPlaceholder label="Photo principale — ambiance ferme" className="absolute inset-0 w-full h-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-green-900/90 via-green-900/50 to-transparent" />
        <div className="relative max-w-7xl mx-auto px-6 h-full flex flex-col justify-end pb-8">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/carte" className="text-[12px] text-green-100/80 hover:text-white flex items-center gap-1.5">
              ← Retour à la carte
            </Link>
          </div>
          <h1 className="font-serif text-[44px] md:text-[64px] text-white leading-[1.02] tracking-tight">{p.name}</h1>
          <p className="mt-1 text-[16px] text-green-100/90">{p.commune}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ProducerBadge kind="stock" score={p.scores.stock} />
            <ProducerBadge kind="response" score={p.scores.response} />
            <ProducerBadge kind="reliability" score={p.scores.reliability} />
          </div>
        </div>
      </section>

      {/* 2. NAV SECTION STICKY */}
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
            <StarRating value={p.rating} readOnly size="sm" />
            <span className="font-semibold text-green-900 tabular-nums">{p.rating.toFixed(1)}</span>
            <span className="text-dark/60">· {p.reviewCount} avis</span>
          </div>
        </div>
      </nav>

      {/* 3. HISTOIRE */}
      <section id="histoire" className="max-w-7xl mx-auto px-6 py-16 md:py-24 scroll-mt-32">
        <div className="grid md:grid-cols-[5fr_6fr] gap-10 md:gap-16 items-start">
          <div>
            <PhotoPlaceholder label="Photo de famille devant la ferme" className="aspect-[4/5] w-full rounded-2xl" />
            <div className="mt-6 grid grid-cols-3 gap-3">
              <InfoKey stat={`${p.generations}e`} label="génération" />
              <InfoKey stat={`${p.sizeHa}`} label="hectares" />
              <InfoKey stat={`${2026 - p.since}+`} label="ans d'élevage" />
            </div>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Notre histoire</span>
            <h2 className="mt-2 font-serif text-[38px] md:text-[48px] text-green-900 leading-tight">Élever moins, élever mieux.</h2>
            <div className="mt-6 space-y-4 text-[15px] text-dark/80 leading-relaxed max-w-xl">
              {p.story.map((para, i) => <p key={i}>{para}</p>)}
            </div>
            <div className="mt-8">
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/60 font-semibold mb-2">Espèces élevées</div>
              <div className="flex flex-wrap gap-1.5 mb-4">{p.species.map((s) => <Badge key={s}>{s}</Badge>)}</div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/60 font-semibold mb-2">Labels & certifications</div>
              <div className="flex flex-wrap gap-1.5">{p.labels.map((l) => <Badge key={l} variant="terra">{l}</Badge>)}</div>
            </div>
          </div>
        </div>

        <div className="mt-14">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold mb-4">La ferme en images</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {p.gallery.map((_, i) => (
              <PhotoPlaceholder key={i} label={`Photo ${i + 1}`} className={`rounded-xl ${i === 0 ? 'md:row-span-2 md:col-span-2 aspect-[4/3]' : 'aspect-[4/3]'}`} />
            ))}
          </div>
        </div>
      </section>

      {/* 4. PRODUITS */}
      <section id="produits" className="bg-green-100/40 border-y border-dark/[0.04] scroll-mt-32">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Au catalogue</span>
              <h2 className="mt-2 font-serif text-[38px] md:text-[48px] text-green-900 leading-tight">Nos produits disponibles</h2>
            </div>
            <span className="text-[13px] text-dark/60 mono">Mis à jour aujourd'hui à 08h12</span>
          </div>

          {p.products.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dark/[0.06] p-10 text-center">
              <h3 className="font-serif text-[22px] text-green-900">Revenez bientôt</h3>
              <p className="text-[14px] text-dark/60 mt-1 max-w-sm mx-auto">Aucun produit actif pour le moment. Pierre remet des pièces en vente chaque semaine.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {p.products.map((prod) => (
                <Link key={prod.id} href={`/producteurs/${p.slug}/produits/${prod.id}`}>
                  <ProductCard product={prod} onClick={() => {}} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 5. AVIS */}
      <section id="avis" className="max-w-7xl mx-auto px-6 py-16 md:py-24 scroll-mt-32">
        <div className="grid md:grid-cols-[auto_1fr] gap-12 items-start">
          <div className="md:sticky md:top-36">
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Avis clients</span>
            <div className="mt-3 font-serif text-[72px] text-green-900 leading-none tabular-nums">{p.rating.toFixed(1)}</div>
            <StarRating value={p.rating} readOnly size="lg" className="mt-2" />
            <div className="mt-2 text-[14px] text-dark/60">{p.reviewCount} avis vérifiés</div>
          </div>

          <div className="space-y-4">
            {visibleReviews.map((r, i) => (
              <article key={i} className="bg-white rounded-2xl border border-dark/[0.06] p-6 shadow-soft">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-green-700 text-white flex items-center justify-center font-semibold">{r.firstName[0]}</div>
                    <div>
                      <div className="text-[14px] font-semibold text-dark">{r.firstName}</div>
                      <div className="text-[12px] text-dark/50">{r.date}</div>
                    </div>
                  </div>
                  <StarRating value={r.rating} readOnly size="sm" />
                </div>
                <p className="text-[14px] text-dark/80 leading-relaxed">{r.text}</p>
              </article>
            ))}
            {canLoadMore && (
              <div className="text-center pt-4">
                <Button variant="secondary" onClick={() => setPage(page + 1)}>Voir plus d'avis</Button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 6. STICKY BOTTOM BAR (mobile) */}
      <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-white border-t border-dark/[0.08] shadow-[0_-4px_16px_rgba(27,67,50,0.08)] p-3">
        <Button size="lg" className="w-full" onClick={scrollToProducts}>
          Commander chez {p.name.split(' ').slice(-2).join(' ')} →
        </Button>
      </div>
    </div>
  );
}

function InfoKey({ stat, label }: { stat: string; label: string }) {
  return (
    <div className="bg-white rounded-xl border border-dark/[0.06] p-3 text-center">
      <div className="font-serif text-[28px] text-green-900 leading-none">{stat}</div>
      <div className="text-[11px] uppercase tracking-[0.1em] text-dark/60 mt-1">{label}</div>
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
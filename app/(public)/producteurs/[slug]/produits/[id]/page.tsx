'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Badge,
  ProductCard,
} from '@/components/ui';

// ---- Mock data (à remplacer par fetch server-side basé sur params.slug / params.id)
const PRODUCER = {
  slug: 'ferme-des-chenes',
  name: 'Ferme des Chênes',
  commune: "Parigné-l'Évêque",
  lat: 47.9458,
  lng: 0.3239,
  address: 'Route de la Vallée · 72250',
};

const PRODUCT = {
  id: 'entrecote',
  name: 'Entrecôte maturée 21 jours',
  category: 'Bœuf Charolais',
  price: 34.5,
  unit: 'kg',
  weightStep: 0.25,
  stockLeft: 5.5,
  stockUnlimited: false,
  delaiJours: 2,
  photos: [null, null, null, null],
  description: [
    "Une entrecôte issue d'un bœuf Charolais élevé à l'herbe sur nos prairies naturelles, puis maturée sur os pendant 21 jours dans notre chambre froide. Cette maturation développe des arômes complexes et une tendreté incomparable.",
    "Idéale pour une cuisson à la poêle ou au grill, 3 minutes par face pour une cuisson saignante. Sortez la viande 30 minutes avant cuisson et salez-la après cuisson pour préserver ses sucs.",
  ],
  slots: [
    { id: 'sam-10', label: 'Samedi 25 avril', time: '10h00 – 12h00', left: 4 },
    { id: 'sam-14', label: 'Samedi 25 avril', time: '14h00 – 17h00', left: 8 },
    { id: 'mer-17', label: 'Mercredi 29 avril', time: '17h00 – 19h00', left: 6 },
    { id: 'sam-02', label: 'Samedi 2 mai', time: '10h00 – 12h00', left: 10 },
  ],
  otherProducts: [
    { id: 'roti', name: 'Rôti de bœuf Charolais', price: 24.9, unit: 'kg', stockLeft: 12, producer: 'Ferme des Chênes', category: 'Bœuf' },
    { id: 'colis', name: 'Colis découverte 5kg', price: 89, unit: 'colis', stockLeft: 8, producer: 'Ferme des Chênes', category: 'Colis' },
    { id: 'bourguignon', name: 'Bourguignon Charolais', price: 19.9, unit: 'kg', stockLeft: 22, producer: 'Ferme des Chênes', category: 'Bœuf' },
  ],
};

export default function ProductPage({ params }: { params: { slug: string; id: string } }) {
  const [activePhoto, setActivePhoto] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [slot, setSlot] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const p = PRODUCT;
  const step = p.weightStep;
  const weight = quantity * step;
  const total = weight * p.price;
  const maxQty = p.stockUnlimited ? 999 : Math.floor(p.stockLeft / step);

  const stockBadge = useMemo(() => {
    if (p.stockUnlimited) return { variant: 'green' as const, text: 'Stock illimité' };
    if (p.stockLeft === 0) return { variant: 'gray' as const, text: 'Épuisé' };
    if (p.stockLeft <= 3) return { variant: 'terra' as const, text: `Plus que ${p.stockLeft} ${p.unit}` };
    return { variant: 'green' as const, text: `${p.stockLeft} ${p.unit} disponibles` };
  }, [p.stockLeft, p.stockUnlimited, p.unit]);

  const canOrder = p.stockLeft > 0 && slot !== null;

  const handleAdd = () => {
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="min-h-screen bg-bg">
      {/* 1. BREADCRUMB */}
      <nav aria-label="Breadcrumb" className="max-w-7xl mx-auto px-6 pt-6">
        <ol className="flex items-center gap-1.5 text-[12px] text-dark/60 flex-wrap">
          <li><Link href="/" className="hover:text-green-900">Accueil</Link></li>
          <Sep />
          <li><Link href="/carte" className="hover:text-green-900">Producteurs</Link></li>
          <Sep />
          <li><Link href={`/producteurs/${PRODUCER.slug}`} className="hover:text-green-900">{PRODUCER.name}</Link></li>
          <Sep />
          <li className="text-green-900 font-medium truncate max-w-[240px]">{p.name}</li>
        </ol>
      </nav>

      {/* 2. MAIN TWO COLUMNS */}
      <section className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-10 lg:gap-14">
          {/* GAUCHE : galerie */}
          <div>
            <div className="aspect-[4/3] rounded-2xl overflow-hidden relative">
              <PhotoPlaceholder label={`Photo ${activePhoto + 1} — ${p.name}`} className="w-full h-full" />
              <div className="absolute top-4 left-4">
                <Badge variant="terra">{p.category}</Badge>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {p.photos.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActivePhoto(i)}
                  className={`aspect-square rounded-xl overflow-hidden transition-all ${
                    i === activePhoto ? 'ring-2 ring-green-700 ring-offset-2 ring-offset-bg' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  <PhotoPlaceholder label={`${i + 1}`} className="w-full h-full" />
                </button>
              ))}
            </div>
          </div>

          {/* DROITE : infos + achat */}
          <div className="flex flex-col">
            <Link
              href={`/producteurs/${PRODUCER.slug}`}
              className="text-[12px] uppercase tracking-[0.14em] font-semibold text-terra-700 hover:text-terra-300 mb-2"
            >
              {PRODUCER.name} · {PRODUCER.commune}
            </Link>
            <h1 className="font-serif text-[40px] md:text-[48px] text-green-900 leading-[1.05] tracking-tight">
              {p.name}
            </h1>

            {/* Prix */}
            <div className="mt-5 flex items-baseline gap-2">
              <span className="font-serif text-[40px] text-green-900 tabular-nums">
                {p.price.toFixed(2).replace('.', ',')}&nbsp;€
              </span>
              <span className="text-[16px] text-dark/60">/ {p.unit}</span>
            </div>

            {/* Stock + délai */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant={stockBadge.variant}>{stockBadge.text}</Badge>
              {p.delaiJours > 0 && (
                <Badge variant="gray">Disponible sous {p.delaiJours} jour{p.delaiJours > 1 ? 's' : ''}</Badge>
              )}
            </div>

            {/* Description */}
            <div className="mt-6 space-y-3 text-[15px] text-dark/80 leading-relaxed">
              {p.description.map((para, i) => <p key={i}>{para}</p>)}
            </div>

            {/* Quantité */}
            <div className="mt-8">
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/60 font-semibold mb-2">
                Quantité
              </div>
              <div className="flex items-center gap-4">
                <QtyStepper value={quantity} onChange={setQuantity} min={1} max={maxQty} />
                <span className="text-[14px] text-dark/70 tabular-nums">
                  = <span className="font-semibold text-green-900">{weight.toFixed(2).replace('.', ',')} {p.unit}</span>
                </span>
              </div>
            </div>

            {/* Slot de retrait */}
            <div className="mt-6">
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/60 font-semibold mb-2">
                Créneau de retrait à la ferme
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {p.slots.map((s) => {
                  const active = slot === s.id;
                  const full = s.left === 0;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={full}
                      onClick={() => setSlot(s.id)}
                      className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                        full
                          ? 'bg-dark/5 border-dark/10 text-dark/30 cursor-not-allowed'
                          : active
                            ? 'bg-green-100 border-green-700 text-green-900 ring-2 ring-green-700/20'
                            : 'bg-white border-dark/10 text-dark/80 hover:border-green-500'
                      }`}
                    >
                      <div className="text-[14px] font-semibold">{s.label}</div>
                      <div className="text-[12px] text-dark/60">{s.time}</div>
                      <div className="text-[11px] mt-0.5 mono text-dark/50">
                        {full ? 'Complet' : `${s.left} créneaux restants`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* CTA */}
            <div className="mt-8 sticky bottom-0 bg-bg pt-4 pb-2 -mx-1 px-1 lg:static">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-[13px] text-dark/60">Total estimé</span>
                <span className="font-serif text-[28px] text-green-900 tabular-nums">
                  {total.toFixed(2).replace('.', ',')}&nbsp;€
                </span>
              </div>
              <Button size="lg" className="w-full" disabled={!canOrder} onClick={handleAdd}>
                {added ? '✓ Ajouté au panier' : !slot ? 'Choisissez un créneau' : `Ajouter au panier`}
              </Button>
              <p className="text-[11px] text-dark/50 text-center mt-2">
                Vous confirmez votre commande directement avec {PRODUCER.name.split(' ').slice(-2).join(' ')}.
              </p>
            </div>

            {/* Mini-carte */}
            <div className="mt-10 rounded-2xl overflow-hidden border border-dark/[0.06] bg-white">
              <div className="p-4 border-b border-dark/[0.06] flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Retrait</div>
                  <div className="font-serif text-[20px] text-green-900 leading-tight mt-0.5">{PRODUCER.name}</div>
                  <div className="text-[13px] text-dark/60 mt-0.5">{PRODUCER.address}</div>
                </div>
                <Link href={`/producteurs/${PRODUCER.slug}`} className="text-[13px] text-green-700 font-medium hover:text-green-900 whitespace-nowrap">
                  Voir la ferme →
                </Link>
              </div>
              <div className="relative h-44 bg-green-100/50">
                <MiniMapPlaceholder />
                <div className="absolute" style={{ left: '52%', top: '48%', transform: 'translate(-50%, -100%)' }}>
                  <div className="w-9 h-9 bg-green-700 border-[3px] border-white shadow-card flex items-center justify-center"
                       style={{ borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)' }}>
                    <span style={{ transform: 'rotate(45deg)' }} className="text-terra-300">
                      <DotIcon />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. AUTRES PRODUITS */}
      <section className="bg-green-100/40 border-t border-dark/[0.04] mt-12">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
            <div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
                À découvrir aussi
              </span>
              <h2 className="mt-2 font-serif text-[32px] md:text-[40px] text-green-900 leading-tight">
                Chez le même producteur
              </h2>
            </div>
            <Link href={`/producteurs/${PRODUCER.slug}`} className="text-[14px] text-green-700 font-medium hover:text-green-900">
              Voir tous les produits →
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {p.otherProducts.map((prod) => (
              <Link key={prod.id} href={`/producteurs/${PRODUCER.slug}/produits/${prod.id}`}>
                <ProductCard product={prod} onClick={() => {}} />
              </Link>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Sep() {
  return <li aria-hidden className="text-dark/30">/</li>;
}

function QtyStepper({
  value, onChange, min, max,
}: { value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <div className="inline-flex items-stretch rounded-xl border border-dark/10 bg-white">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-11 h-11 flex items-center justify-center text-green-900 hover:bg-green-100 rounded-l-xl disabled:opacity-30 disabled:hover:bg-white"
        aria-label="Diminuer"
      >−</button>
      <div className="w-14 h-11 flex items-center justify-center font-semibold tabular-nums border-x border-dark/10">
        {value}
      </div>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-11 h-11 flex items-center justify-center text-green-900 hover:bg-green-100 rounded-r-xl disabled:opacity-30 disabled:hover:bg-white"
        aria-label="Augmenter"
      >+</button>
    </div>
  );
}

function DotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="6" />
    </svg>
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

function MiniMapPlaceholder() {
  return (
    <svg viewBox="0 0 400 180" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="180" fill="#D8F3DC" />
      <path d="M0 90 Q 120 70 200 95 T 400 80" stroke="#fff" strokeWidth="6" fill="none" opacity="0.9" />
      <path d="M60 0 Q 80 60 150 100 T 220 180" stroke="#fff" strokeWidth="4" fill="none" opacity="0.8" />
      <path d="M280 0 Q 300 60 340 120 T 400 180" stroke="#fff" strokeWidth="4" fill="none" opacity="0.8" />
      <circle cx="50" cy="40" r="18" fill="#74C69D" opacity="0.6" />
      <circle cx="110" cy="150" r="22" fill="#74C69D" opacity="0.6" />
      <circle cx="330" cy="50" r="16" fill="#74C69D" opacity="0.6" />
      <circle cx="360" cy="140" r="20" fill="#74C69D" opacity="0.6" />
      <path d="M0 140 Q 80 150 180 145 T 400 155" stroke="#40916C" strokeWidth="3" fill="none" opacity="0.5" />
    </svg>
  );
}
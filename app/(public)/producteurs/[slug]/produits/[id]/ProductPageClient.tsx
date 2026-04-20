'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Badge, ProductCard } from '@/components/ui';
import { useCartStore } from '@/lib/store/cart';

export type ProducerSummary = {
  id: string;
  slug: string;
  name: string;
  commune: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

export type ProductDetail = {
  id: string;
  name: string;
  category?: string;
  price: number;
  unit: string;
  weightStep: number;
  stockLeft: number;
  stockUnlimited: boolean;
  delaiJours: number;
  photos: (string | null)[];
  description: string[];
};

export type SlotOption = {
  id: string;
  label: string;
  time: string;
  left: number | null;
  dateISO: string;
};

export type OtherProduct = {
  id: string;
  name: string;
  price: number;
  unit: string;
  stockLeft: number;
  producer: string;
  category?: string;
  image?: string | null;
};

export function ProductPageClient({
  producer,
  product,
  slots,
  otherProducts,
}: {
  producer: ProducerSummary;
  product: ProductDetail;
  slots: SlotOption[];
  otherProducts: OtherProduct[];
}) {
  const [activePhoto, setActivePhoto] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [slot, setSlot] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const addItem = useCartStore((s) => s.addItem);

  const step = product.weightStep || 1;
  const weight = quantity * step;
  const total = weight * product.price;
  const maxQty = product.stockUnlimited ? 999 : Math.max(1, Math.floor(product.stockLeft / step));

  const stockBadge = useMemo(() => {
    if (product.stockUnlimited) return { variant: 'green' as const, text: 'Stock illimité' };
    if (product.stockLeft === 0) return { variant: 'gray' as const, text: 'Épuisé' };
    if (product.stockLeft <= 3) return { variant: 'terra' as const, text: `Plus que ${product.stockLeft} ${product.unit}` };
    return { variant: 'green' as const, text: `${product.stockLeft} ${product.unit} disponibles` };
  }, [product.stockLeft, product.stockUnlimited, product.unit]);

  const canOrder = (product.stockUnlimited || product.stockLeft > 0) && slot !== null;

  const handleAdd = () => {
    if (!slot) return;
    const selected = slots.find((s) => s.id === slot);
    if (!selected) return;
    addItem({
      productId: product.id,
      producerId: producer.id,
      slug: producer.slug,
      nom: product.name,
      prix: product.price,
      unite: product.unit,
      quantite: weight,
      creneauId: selected.id,
      dateRetrait: selected.dateISO,
      producerName: producer.name,
      image: product.photos.find((p): p is string => typeof p === 'string') ?? null,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  const photos = product.photos.length > 0 ? product.photos : [null, null, null, null];

  return (
    <div className="min-h-screen bg-bg">
      <nav aria-label="Breadcrumb" className="max-w-7xl mx-auto px-6 pt-6">
        <ol className="flex items-center gap-1.5 text-[12px] text-dark/60 flex-wrap">
          <li><Link href="/" className="hover:text-green-900">Accueil</Link></li>
          <Sep />
          <li><Link href="/carte" className="hover:text-green-900">Producteurs</Link></li>
          <Sep />
          <li><Link href={`/producteurs/${producer.slug}`} className="hover:text-green-900">{producer.name}</Link></li>
          <Sep />
          <li className="text-green-900 font-medium truncate max-w-[240px]">{product.name}</li>
        </ol>
      </nav>

      <section className="max-w-7xl mx-auto px-6 py-10">
        <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-10 lg:gap-14">
          <div>
            <div className="aspect-[4/3] rounded-2xl overflow-hidden relative">
              {photos[activePhoto] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photos[activePhoto] as string} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <PhotoPlaceholder label={`Photo ${activePhoto + 1} — ${product.name}`} className="w-full h-full" />
              )}
              {product.category && (
                <div className="absolute top-4 left-4">
                  <Badge variant="terra">{product.category}</Badge>
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {photos.slice(0, 4).map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActivePhoto(i)}
                  className={`aspect-square rounded-xl overflow-hidden transition-all ${
                    i === activePhoto ? 'ring-2 ring-green-700 ring-offset-2 ring-offset-bg' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <PhotoPlaceholder label={`${i + 1}`} className="w-full h-full" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col">
            <Link
              href={`/producteurs/${producer.slug}`}
              className="text-[12px] uppercase tracking-[0.14em] font-semibold text-terra-700 hover:text-terra-300 mb-2"
            >
              {producer.name} · {producer.commune}
            </Link>
            <h1 className="font-serif text-[40px] md:text-[48px] text-green-900 leading-[1.05] tracking-tight">
              {product.name}
            </h1>

            <div className="mt-5 flex items-baseline gap-2">
              <span className="font-serif text-[40px] text-green-900 tabular-nums">
                {product.price.toFixed(2).replace('.', ',')}&nbsp;€
              </span>
              <span className="text-[16px] text-dark/60">/ {product.unit}</span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant={stockBadge.variant}>{stockBadge.text}</Badge>
              {product.delaiJours > 0 && (
                <Badge variant="gray">Disponible sous {product.delaiJours} jour{product.delaiJours > 1 ? 's' : ''}</Badge>
              )}
            </div>

            {product.description.length > 0 && (
              <div className="mt-6 space-y-3 text-[15px] text-dark/80 leading-relaxed">
                {product.description.map((para, i) => <p key={i}>{para}</p>)}
              </div>
            )}

            <div className="mt-8">
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/60 font-semibold mb-2">
                Quantité
              </div>
              <div className="flex items-center gap-4">
                <QtyStepper value={quantity} onChange={setQuantity} min={1} max={maxQty} />
                <span className="text-[14px] text-dark/70 tabular-nums">
                  = <span className="font-semibold text-green-900">{weight.toFixed(2).replace('.', ',')} {product.unit}</span>
                </span>
              </div>
            </div>

            <div className="mt-6">
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/60 font-semibold mb-2">
                Créneau de retrait à la ferme
              </div>
              {slots.length === 0 ? (
                <div className="rounded-xl border border-dark/10 bg-white px-4 py-6 text-center text-[13px] text-dark/60">
                  Aucun créneau disponible. Revenez bientôt.
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {slots.map((s) => {
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
                        {s.left !== null && (
                          <div className="text-[11px] mt-0.5 mono text-dark/50">
                            {full ? 'Complet' : `${s.left} créneaux restants`}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

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
                Vous confirmez votre commande directement avec {producer.name.split(' ').slice(-2).join(' ')}.
              </p>
            </div>

            <div className="mt-10 rounded-2xl overflow-hidden border border-dark/[0.06] bg-white">
              <div className="p-4 border-b border-dark/[0.06] flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Retrait</div>
                  <div className="font-serif text-[20px] text-green-900 leading-tight mt-0.5">{producer.name}</div>
                  <div className="text-[13px] text-dark/60 mt-0.5">{producer.address}</div>
                </div>
                <Link href={`/producteurs/${producer.slug}`} className="text-[13px] text-green-700 font-medium hover:text-green-900 whitespace-nowrap">
                  Voir la ferme →
                </Link>
              </div>
              <div className="relative h-44 bg-green-100/50">
                <MiniMapPlaceholder />
              </div>
            </div>
          </div>
        </div>
      </section>

      {otherProducts.length > 0 && (
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
              <Link href={`/producteurs/${producer.slug}`} className="text-[14px] text-green-700 font-medium hover:text-green-900">
                Voir tous les produits →
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {otherProducts.map((prod) => (
                <Link key={prod.id} href={`/producteurs/${producer.slug}/produits/${prod.id}`}>
                  <ProductCard product={prod} onClick={() => {}} />
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

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
      <circle cx="50" cy="40" r="18" fill="#74C69D" opacity="0.6" />
      <circle cx="110" cy="150" r="22" fill="#74C69D" opacity="0.6" />
      <circle cx="330" cy="50" r="16" fill="#74C69D" opacity="0.6" />
      <circle cx="360" cy="140" r="20" fill="#74C69D" opacity="0.6" />
    </svg>
  );
}

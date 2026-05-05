'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Button, Badge, ProductCard } from '@/components/ui';
import { useCartStore } from '@/lib/store/cart';
import { formatSlotTime, formatSlotRange } from '@/lib/slots/format-slot-time';
import { useUserContext } from '@/components/providers/user-provider';
import { StockAlertForm } from './_components/StockAlertForm';
import { MiniMapLazy } from './_components/MiniMapLazy';

export type ProducerSummary = {
  id: string;
  slug: string;
  name: string;
  // Nullable pendant la fenêtre transitoire des 3 migrations. Après
  // migration C, toujours string non-vide, mais le post-it prévoit un
  // early return si null pour éviter d'afficher "Le conseil de null".
  firstName: string | null;
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
  conseil: { active: boolean; texte: string | null };
};

export type SlotOption = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity_per_slot: number;
  left: number | null;
};

const PARIS_TZ = 'Europe/Paris';

function formatDayLabel(isoUtc: string): string {
  const str = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(isoUtc));
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function toParisDateISO(isoUtc: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(isoUtc));
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${d}`;
}

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

  // Groupement par jour calendaire Europe/Paris. Les slots arrivent triés
  // starts_at ASC côté server → l'ordre d'insertion dans la Map conserve
  // la chronologie.
  const groupedEntries = useMemo<[string, SlotOption[]][]>(() => {
    const map = new Map<string, SlotOption[]>();
    for (const s of slots) {
      const key = toParisDateISO(s.starts_at);
      const bucket = map.get(key) ?? [];
      if (bucket.length === 0) map.set(key, bucket);
      bucket.push(s);
    }
    return Array.from(map.entries());
  }, [slots]);

  // Accordéon exclusif : 1er jour ouvert par défaut, null = tous fermés.
  // L'état survit aux re-renders ; si `slots` change et que la date
  // actuellement ouverte disparaît, aucun panel n'apparaît (acceptable).
  const [openDate, setOpenDate] = useState<string | null>(
    () => groupedEntries[0]?.[0] ?? null,
  );

  const addItem = useCartStore((s) => s.addItem);

  // Guard UI anti-achat auto-référentiel : si le user logué est le
  // producer propriétaire, on désactive le CTA. Double garde DB côté RPC
  // create_order_with_items (bloc 2bis) si l'UI est contournée.
  // Pendant le chargement du UserProvider (useUserContext().loading), on
  // laisse le bouton actif : la RPC reste le filet de sécurité ultime.
  const { producer: myProducer } = useUserContext();
  const isOwnProduct = !!myProducer && myProducer.id === producer.id;

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

  const canOrder = !isOwnProduct && (product.stockUnlimited || product.stockLeft > 0) && slot !== null;

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
      dateRetrait: toParisDateISO(selected.starts_at),
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
                <Image
                  src={photos[activePhoto] as string}
                  alt={product.name}
                  fill
                  sizes="(min-width: 1024px) 55vw, 100vw"
                  priority
                  className="object-cover"
                />
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
                  className={`relative aspect-square rounded-xl overflow-hidden transition-all ${
                    i === activePhoto ? 'ring-2 ring-green-700 ring-offset-2 ring-offset-bg' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  {url ? (
                    <Image
                      src={url}
                      alt=""
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
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
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-[40px] md:text-[48px] text-green-900 leading-[1.05] tracking-tight">
                {product.name}
              </h1>
              {product.conseil.active && product.conseil.texte && producer.firstName && (
                <ConseilPopover
                  texte={product.conseil.texte}
                  firstName={producer.firstName}
                />
              )}
            </div>

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
              {groupedEntries.length === 0 ? (
                <div className="rounded-xl border border-dark/10 bg-white px-4 py-6 text-center text-[13px] text-dark/60">
                  Aucun créneau disponible. Revenez bientôt.
                </div>
              ) : (
                <div className="space-y-2">
                  {groupedEntries.map(([date, daySlots]) => (
                    <DayGroup
                      key={date}
                      date={date}
                      slots={daySlots}
                      isOpen={openDate === date}
                      selectedSlotId={slot}
                      onToggle={() => setOpenDate(openDate === date ? null : date)}
                      onSelectSlot={(id) => setSlot(id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="mt-8 sticky bottom-0 bg-bg pt-4 pb-2 -mx-1 px-1 lg:static">
              {!isOwnProduct && !product.stockUnlimited && product.stockLeft === 0 ? (
                <StockAlertForm productId={product.id} productName={product.name} />
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3 px-1">
                    <span className="text-[13px] text-dark/60">Total estimé</span>
                    <span className="font-serif text-[28px] text-green-900 tabular-nums">
                      {total.toFixed(2).replace('.', ',')}&nbsp;€
                    </span>
                  </div>
                  <Button size="lg" className="w-full" disabled={!canOrder} onClick={handleAdd}>
                    {isOwnProduct
                      ? 'Votre produit'
                      : added
                        ? '✓ Ajouté au panier'
                        : !slot
                          ? 'Choisissez un créneau'
                          : `Ajouter au panier`}
                  </Button>
                  <p className="text-[11px] text-dark/50 text-center mt-2">
                    Vous confirmez votre commande directement avec {producer.name.split(' ').slice(-2).join(' ')}.
                  </p>
                </>
              )}
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
                {producer.lat != null && producer.lng != null ? (
                  <MiniMapLazy
                    latitude={producer.lat}
                    longitude={producer.lng}
                    markerLabel={`${producer.name} — ${producer.commune}`}
                    zoom={11}
                  />
                ) : (
                  <MiniMapPlaceholder />
                )}
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

// Popover "Conseil de l'éleveur" : icône à côté du h1 produit. Ouverture
// au clic (desktop + mobile) et au hover (desktop uniquement, via
// matchMedia '(hover: hover)' qui exclut les devices touch-only pour
// éviter le sticky-hover d'iOS Safari). Fermeture par Escape, click-
// outside, bouton ×, ou mouseleave (délai 200ms pour tolérer le gap
// entre bouton et popover). ARIA dialog non-modal.
function ConseilPopover({
  texte,
  firstName,
}: {
  texte: string;
  firstName: string;
}) {
  const [open, setOpen] = useState(false);
  const [isHoverDevice, setIsHoverDevice] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogId = useId();
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    const mql = window.matchMedia('(hover: hover)');
    const update = () => setIsHoverDevice(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  const cancelCloseTimer = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelCloseTimer(), [cancelCloseTimer]);

  const handleMouseEnter = () => {
    if (!isHoverDevice) return;
    cancelCloseTimer();
    setOpen(true);
  };

  const handleMouseLeave = () => {
    if (!isHoverDevice) return;
    cancelCloseTimer();
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, 200);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [open, close]);

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        aria-label={`Voir le conseil de ${firstName}`}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-amber-500 transition-colors hover:bg-amber-50 hover:text-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <PostItIcon />
      </button>
      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="absolute left-0 top-full z-30 mt-2 w-[320px] max-w-[calc(100vw-3rem)] rounded-lg border border-amber-200/60 bg-[#FFF7D6] px-5 py-4 pr-8 shadow-lg"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Fermer"
            className="absolute right-2 top-2 rounded-md p-1 text-dark/40 transition-colors hover:bg-amber-100/70 hover:text-dark/70"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div
            id={titleId}
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700"
          >
            Le conseil de {firstName}
          </div>
          <blockquote className="mt-2 font-serif text-[15px] italic leading-relaxed text-dark/85">
            « {texte} »
          </blockquote>
          <div className="mt-2 text-right font-serif text-[13px] italic text-green-900">
            — {firstName}
          </div>
        </div>
      )}
    </div>
  );
}

function PostItIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <g transform="rotate(-5 10 10)">
        <path
          d="M3 3 L14 3 L17 6 L17 17 L3 17 Z"
          fill="#FEF3C7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M14 3 L14 6 L17 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <line
          x1="5.5"
          y1="10"
          x2="12"
          y2="10"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.55"
        />
        <line
          x1="5.5"
          y1="13"
          x2="13"
          y2="13"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.55"
        />
      </g>
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 text-dark/40 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function DayGroup({
  date,
  slots,
  isOpen,
  selectedSlotId,
  onToggle,
  onSelectSlot,
}: {
  date: string;
  slots: SlotOption[];
  isOpen: boolean;
  selectedSlotId: string | null;
  onToggle: () => void;
  onSelectSlot: (id: string) => void;
}) {
  const firstIso = slots[0].starts_at;
  const count = slots.length;
  const selectedInDay = slots.find((s) => s.id === selectedSlotId) ?? null;
  const panelId = `creneaux-${date}`;

  return (
    <div className="rounded-xl border border-dark/10 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-dark/[0.02]"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-[14px] font-semibold text-green-900">
            {formatDayLabel(firstIso)}
          </span>
          {selectedInDay && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-900">
              ✓ {formatSlotTime(selectedInDay.starts_at)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[12px] text-dark/50">
            {count} créneau{count > 1 ? 'x' : ''}
          </span>
          <Chevron open={isOpen} />
        </div>
      </button>
      {isOpen && (
        <div id={panelId} className="border-t border-dark/[0.06] bg-dark/[0.02] p-3">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slots.map((s) => {
              const active = selectedSlotId === s.id;
              const full = s.left === 0;
              const label = formatSlotRange(s.starts_at, s.ends_at);
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={full}
                  onClick={() => onSelectSlot(s.id)}
                  aria-label={`Créneau ${label}`}
                  aria-pressed={active}
                  className={`rounded-lg border px-2 py-1.5 text-[13px] tabular-nums transition-colors ${
                    full
                      ? 'bg-dark/5 border-dark/10 text-dark/30 cursor-not-allowed'
                      : active
                        ? 'bg-green-100 border-green-700 text-green-900 font-semibold ring-2 ring-green-700/20'
                        : 'bg-white border-dark/10 text-dark/80 hover:border-green-500'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
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

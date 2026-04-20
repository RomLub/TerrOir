'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, ProducerCard } from '@/components/ui';
import { labelEspece, labelLabel } from '@/lib/producers/labels';

type SearchResult = {
  id: string;
  slug: string;
  nom_exploitation: string;
  commune: string | null;
  code_postal: string | null;
  latitude: number;
  longitude: number;
  photo_principale: string | null;
  especes: string[] | null;
  labels: string[] | null;
  badge_stock_score: number | null;
  badge_confirmation_score: number | null;
  badge_annulation_score: number | null;
  distance_km: number;
  note_moyenne: number | null;
  nb_avis: number | null;
  product_count: number | null;
};

type ApiResponse = { count: number; results: SearchResult[] } | { error: string };

const LE_MANS = { lat: 48.0061, lng: 0.1996 };

const ESPECE_OPTIONS: { value: string; label: string }[] = [
  { value: 'bovin', label: 'Bœuf' },
  { value: 'porcin', label: 'Porc' },
  { value: 'ovin', label: 'Agneau' },
];

const LABEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'bio', label: 'Bio' },
  { value: 'label_rouge', label: 'Label Rouge' },
  { value: 'aop', label: 'AOP' },
  { value: 'boeuf_fermier_maine', label: 'Bœuf du Maine' },
];

const RADIUS_OPTIONS = [10, 25, 50, 100];

export default function ProducteursPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-dark/60">Chargement…</div>}>
      <ProducteursPageContent />
    </Suspense>
  );
}

function ProducteursPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [especes, setEspeces] = useState<string[]>(() =>
    searchParams.get('especes')?.split(',').filter(Boolean) ?? [],
  );
  const [labels, setLabels] = useState<string[]>(() =>
    searchParams.get('labels')?.split(',').filter(Boolean) ?? [],
  );
  const [radius, setRadius] = useState<number>(() => Number(searchParams.get('rayon')) || 50);

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setUserLoc(LE_MANS);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setUserLoc(LE_MANS);
        setLocError('Position indisponible — centré sur Le Mans');
        setLocating(false);
      },
      { timeout: 8000 },
    );
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (especes.length) params.set('especes', especes.join(','));
    if (labels.length) params.set('labels', labels.join(','));
    if (radius !== 50) params.set('rayon', String(radius));
    const q = params.toString();
    router.replace(q ? `/producteurs?${q}` : '/producteurs', { scroll: false });
  }, [especes, labels, radius, router]);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!userLoc) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const params = new URLSearchParams({
      lat: String(userLoc.lat),
      lng: String(userLoc.lng),
      radius: String(radius),
    });
    if (especes.length) params.set('especes', especes.join(','));
    if (labels.length) params.set('labels', labels.join(','));

    setLoading(true);
    setFetchError(null);
    fetch(`/api/producers/search?${params.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((data) => {
        if ('error' in data) {
          setFetchError(data.error);
          setResults([]);
        } else {
          setResults(data.results);
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setFetchError('Erreur de chargement');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [userLoc, radius, especes, labels]);

  const toggle = useCallback(<T extends string>(arr: T[], v: T, setter: (a: T[]) => void) => {
    setter(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }, []);
  const clearAll = () => { setEspeces([]); setLabels([]); setRadius(50); };

  const activeFilters = especes.length + labels.length + (radius !== 50 ? 1 : 0);

  const cards = useMemo(() => results.map((r) => {
    const commune = [r.commune, r.code_postal].filter(Boolean).join(' · ');
    return {
      slug: r.slug,
      data: {
        name: r.nom_exploitation,
        commune: commune || '—',
        distanceKm: r.distance_km,
        species: (r.especes ?? []).map(labelEspece),
        labels: (r.labels ?? []).map(labelLabel),
        scores: {
          stock: Math.round(r.badge_stock_score ?? 0),
          response: Math.round(r.badge_confirmation_score ?? 0),
          reliability: Math.round(r.badge_annulation_score ?? 0),
        },
        rating: Number(r.note_moyenne ?? 0),
        reviewCount: r.nb_avis ?? 0,
        productCount: r.product_count ?? 0,
        photo: r.photo_principale ?? null,
      },
    };
  }), [results]);

  return (
    <div className="min-h-screen bg-bg">
      <section className="max-w-7xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Annuaire</span>
            <h1 className="mt-2 font-serif text-[40px] md:text-[52px] text-green-900 leading-[1.05] tracking-tight">
              Tous les producteurs près de chez vous
            </h1>
            <p className="mt-2 text-[15px] text-dark/70 max-w-xl">
              {loading
                ? 'Recherche en cours…'
                : `${results.length} producteur${results.length > 1 ? 's' : ''} dans un rayon de ${radius} km`}
            </p>
            {locError && <p className="mt-1 text-[12px] text-terra-700">{locError}</p>}
            {fetchError && <p className="mt-1 text-[12px] text-terra-700">{fetchError}</p>}
            {locating && <p className="mt-1 text-[12px] text-dark/55">Localisation en cours…</p>}
          </div>
          <Link href="/carte">
            <Button variant="secondary">Vue carte →</Button>
          </Link>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-6">
        <div className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5 space-y-4">
          <FilterGroup label="Espèces">
            <div className="flex flex-wrap gap-1.5">
              {ESPECE_OPTIONS.map((o) => (
                <Chip key={o.value} active={especes.includes(o.value)} onClick={() => toggle(especes, o.value, setEspeces)}>
                  {o.label}
                </Chip>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup label="Labels & certifications">
            <div className="flex flex-wrap gap-1.5">
              {LABEL_OPTIONS.map((o) => (
                <Chip key={o.value} active={labels.includes(o.value)} onClick={() => toggle(labels, o.value, setLabels)} variant="terra">
                  {o.label}
                </Chip>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup label={`Rayon · ${radius} km`}>
            <div className="flex gap-1.5">
              {RADIUS_OPTIONS.map((r) => (
                <Chip key={r} active={radius === r} onClick={() => setRadius(r)}>
                  {r} km
                </Chip>
              ))}
            </div>
          </FilterGroup>
          {activeFilters > 0 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[12px] text-dark/60">{activeFilters} filtre{activeFilters > 1 ? 's' : ''} actif{activeFilters > 1 ? 's' : ''}</span>
              <Button variant="ghost" size="sm" onClick={clearAll}>Réinitialiser</Button>
            </div>
          )}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-20">
        {cards.length === 0 && !loading ? (
          <div className="bg-white rounded-2xl border border-dark/[0.06] p-12 text-center">
            <h3 className="font-serif text-[24px] text-green-900">Aucun producteur</h3>
            <p className="text-[14px] text-dark/60 mt-1 max-w-md mx-auto">Essayez d&apos;élargir le rayon ou de retirer des filtres.</p>
            <div className="mt-4"><Button variant="secondary" size="sm" onClick={clearAll}>Réinitialiser</Button></div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {cards.map((c) => (
              <Link key={c.slug} href={`/producteurs/${c.slug}`} className="block">
                <ProducerCard producer={c.data} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-dark/60 font-semibold mb-2">{label}</div>
      {children}
    </div>
  );
}

function Chip({
  children, active, onClick, variant = 'green',
}: {
  children: React.ReactNode; active: boolean; onClick: () => void; variant?: 'green' | 'terra';
}) {
  const activeCls = variant === 'terra'
    ? 'bg-terra-700 text-white border-terra-700'
    : 'bg-green-700 text-white border-green-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-full text-[13px] font-medium border transition-colors ${
        active ? activeCls : 'bg-white text-dark/70 border-dark/10 hover:border-green-500 hover:text-green-900'
      }`}
    >
      {children}
    </button>
  );
}

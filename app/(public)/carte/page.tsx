'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { Button, ProducerCard } from '@/components/ui';
import { GEOLOC_FALLBACK } from '@/lib/geoloc/fallback';
import { labelEspece, labelLabel } from '@/lib/producers/labels';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

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

export default function CartePage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-dark/60">Chargement de la carte…</div>}>
      <CartePageContent />
    </Suspense>
  );
}

function CartePageContent() {
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setUserLoc({ lat: GEOLOC_FALLBACK.lat, lng: GEOLOC_FALLBACK.lng });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setUserLoc({ lat: GEOLOC_FALLBACK.lat, lng: GEOLOC_FALLBACK.lng });
        setLocError(`Position indisponible — centré sur ${GEOLOC_FALLBACK.label}`);
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
    router.replace(q ? `/carte?${q}` : '/carte', { scroll: false });
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

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    if (!mapboxgl.accessToken) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [GEOLOC_FALLBACK.lng, GEOLOC_FALLBACK.lat],
      zoom: 8.4,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    // Backup resize après le 1er paint : si le conteneur n'avait pas encore
    // ses dimensions finales à l'instant du new Map(), trackResize peut rater
    // le 1er trigger. On force une resize() une fois la layout stabilisée.
    const raf = requestAnimationFrame(() => map.resize());

    // Self-healing : un ResizeObserver explicite rattrape tous les cas où le
    // canvas interne de Mapbox reste à 0 parce que le conteneur a grandi
    // après l'init (cascade flex tardive, fonts qui décalent, etc.).
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainer.current);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !userLoc) return;
    mapRef.current.flyTo({ center: [userLoc.lng, userLoc.lat], zoom: 9, duration: 900 });
  }, [userLoc]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    results.forEach((p) => {
      const el = document.createElement('button');
      el.className = 'producer-marker';
      el.setAttribute('aria-label', p.nom_exploitation);
      el.style.cssText = `
        width: 36px; height: 36px; border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg); background: #2D6A4F; border: 3px solid #fff;
        box-shadow: 0 4px 12px rgba(27,67,50,0.35); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: transform 180ms, background 180ms;
      `;
      el.innerHTML = `<span style="transform: rotate(45deg); color:#D4841A; font-weight:700; font-size:14px;">●</span>`;

      el.addEventListener('mouseenter', () => setHoveredId(p.id));
      el.addEventListener('mouseleave', () => setHoveredId(null));
      el.addEventListener('click', () => {
        window.location.href = `/producteurs/${p.slug}`;
      });

      const popup = new mapboxgl.Popup({ offset: 30, closeButton: false, className: 'terroir-popup' })
        .setHTML(`
          <div style="font-family: Inter, sans-serif; min-width: 200px;">
            <div style="font-family: 'Cormorant Garamond', serif; font-size: 18px; color: #1B4332; font-weight: 600;">${p.nom_exploitation}</div>
            <div style="font-size: 12px; color: #212529a0; margin-top: 2px;">${p.commune ?? ''} · ${p.distance_km.toFixed(1)} km</div>
            <div style="margin-top: 8px; font-size: 13px; color: #2D6A4F; font-weight: 500;">Voir la ferme →</div>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([p.longitude, p.latitude])
        .setPopup(popup)
        .addTo(map);

      markersRef.current[p.id] = marker;
    });
  }, [results]);

  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, m]) => {
      const el = m.getElement() as HTMLElement;
      if (id === hoveredId) {
        el.style.background = '#D4841A';
        el.style.transform = 'rotate(-45deg) scale(1.25)';
        el.style.zIndex = '10';
      } else {
        el.style.background = '#2D6A4F';
        el.style.transform = 'rotate(-45deg) scale(1)';
        el.style.zIndex = '';
      }
    });
  }, [hoveredId]);

  const toggle = <T extends string>(arr: T[], v: T, setter: (a: T[]) => void) =>
    setter(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const clearAll = () => { setEspeces([]); setLabels([]); setRadius(50); };

  const activeFilters = especes.length + labels.length + (radius !== 50 ? 1 : 0);

  const cards = useMemo(() => results.map((r) => ({
    id: r.id,
    slug: r.slug,
    data: {
      name: r.nom_exploitation,
      commune: [r.commune, r.code_postal].filter(Boolean).join(' · ') || '—',
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
  })), [results]);

  return (
    <div className="bg-bg flex flex-col h-[calc(100dvh-4rem)] min-h-[600px]">
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
        <aside className="w-full lg:w-[40%] lg:max-w-[560px] border-r border-dark/[0.06] flex flex-col overflow-hidden flex-1 lg:flex-initial">
          <div className="p-6 border-b border-dark/[0.06]">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h1 className="font-serif text-[32px] text-green-900 leading-tight">Carte des éleveurs</h1>
                <p className="text-[13px] text-dark/60 mt-1">
                  {loading
                    ? 'Recherche…'
                    : `${results.length} producteur${results.length > 1 ? 's' : ''} dans un rayon de ${radius} km`}
                </p>
              </div>
              {locating && <span className="text-[11px] mono text-dark/50">Localisation…</span>}
            </div>
            {locError && <p className="mt-2 text-[12px] text-terra-700">{locError}</p>}
            {fetchError && <p className="mt-2 text-[12px] text-terra-700">{fetchError}</p>}
          </div>

          <div className="p-6 border-b border-dark/[0.06] space-y-5 bg-white">
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

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cards.length === 0 && !loading ? (
              <div className="bg-white rounded-2xl border border-dark/[0.06] p-8 text-center">
                <h3 className="font-serif text-[20px] text-green-900">Aucun producteur</h3>
                <p className="text-[13px] text-dark/60 mt-1">Essayez d&apos;élargir le rayon ou de retirer des filtres.</p>
                <div className="mt-4"><Button variant="secondary" size="sm" onClick={clearAll}>Réinitialiser</Button></div>
              </div>
            ) : (
              cards.map((c) => (
                <Link
                  key={c.id}
                  href={`/producteurs/${c.slug}`}
                  onMouseEnter={() => setHoveredId(c.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`block rounded-2xl transition-all ${hoveredId === c.id ? 'ring-2 ring-terra-300 ring-offset-2 ring-offset-bg' : ''}`}
                >
                  <ProducerCard producer={c.data} />
                </Link>
              ))
            )}
          </div>
        </aside>

        <div className="relative w-full h-[400px] shrink-0 lg:h-auto lg:flex-1 lg:min-h-0">
          {mapboxgl.accessToken ? (
            <div ref={mapContainer} className="h-full w-full" />
          ) : (
            <MapFallback />
          )}

          <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur rounded-xl shadow-card p-3 text-[12px] z-10">
            <div className="font-semibold text-green-900 mb-2 text-[11px] uppercase tracking-[0.12em]">Légende</div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-4 h-4 rounded-full bg-green-700 border-2 border-white shadow-soft" /> Producteur
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full bg-terra-300 border-2 border-white shadow-soft" /> Au survol
            </div>
          </div>

          {userLoc && (
            <div className="absolute top-4 left-4 bg-white/95 backdrop-blur rounded-full shadow-soft px-3 py-1.5 text-[12px] text-dark/70 z-10 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              {userLoc.lat === GEOLOC_FALLBACK.lat && userLoc.lng === GEOLOC_FALLBACK.lng
                ? `${GEOLOC_FALLBACK.label} (par défaut)`
                : 'Votre position'}
            </div>
          )}
        </div>
      </div>
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

function MapFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
      <div className="font-serif text-[24px] text-green-900">Carte indisponible</div>
      <p className="text-[13px] text-dark/60 mt-2 max-w-sm">
        Définissez <code className="mono text-[12px] bg-dark/5 px-1 rounded">NEXT_PUBLIC_MAPBOX_TOKEN</code> dans <code className="mono text-[12px] bg-dark/5 px-1 rounded">.env.local</code> pour afficher la carte.
      </p>
    </div>
  );
}

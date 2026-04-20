'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import {
  Button,
  Badge,
  ProducerCard,
} from '@/components/ui';

// Token côté client — à définir dans .env.local
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Species = 'boeuf' | 'porc' | 'agneau' | 'volaille' | 'veau';
type LabelCert = 'AB' | 'LabelRouge' | 'HVE' | 'AOP';

interface Producer {
  id: string;
  slug: string;
  name: string;
  commune: string;
  lat: number;
  lng: number;
  species: Species[];
  labels: LabelCert[];
  distanceKm?: number;
  scores: { stock: number; response: number; reliability: number };
  rating: number;
  reviewCount: number;
  productCount: number;
  photo?: string | null;
}

// ---------------------------------------------------------------------------
// Mock producers (à remplacer par fetch server-side)
// ---------------------------------------------------------------------------

const LE_MANS = { lat: 48.0061, lng: 0.1996 };

const PRODUCERS: Producer[] = [
  { id: '1', slug: 'ferme-des-chenes', name: 'Ferme des Chênes', commune: "Parigné-l'Évêque", lat: 47.9458, lng: 0.3239,
    species: ['boeuf', 'agneau'], labels: ['AB', 'LabelRouge'],
    scores: { stock: 98, response: 94, reliability: 100 }, rating: 4.8, reviewCount: 127, productCount: 6 },
  { id: '2', slug: 'gaec-du-pre-vert', name: 'GAEC du Pré Vert', commune: 'Conlie', lat: 48.1208, lng: 0.0172,
    species: ['boeuf', 'veau'], labels: ['HVE'],
    scores: { stock: 92, response: 88, reliability: 96 }, rating: 4.6, reviewCount: 84, productCount: 9 },
  { id: '3', slug: 'les-volailles-de-sille', name: 'Les Volailles de Sillé', commune: 'Sillé-le-Guillaume', lat: 48.1822, lng: -0.1233,
    species: ['volaille'], labels: ['LabelRouge', 'AB'],
    scores: { stock: 88, response: 72, reliability: 94 }, rating: 4.7, reviewCount: 56, productCount: 4 },
  { id: '4', slug: 'ferme-bio-saosnois', name: 'Ferme Bio du Saosnois', commune: 'Mamers', lat: 48.3486, lng: 0.3692,
    species: ['porc', 'volaille'], labels: ['AB'],
    scores: { stock: 74, response: 65, reliability: 82 }, rating: 4.3, reviewCount: 39, productCount: 7 },
  { id: '5', slug: 'elevage-loue', name: 'Élevage de Loué', commune: 'Loué', lat: 47.9853, lng: -0.1558,
    species: ['volaille'], labels: ['LabelRouge'],
    scores: { stock: 96, response: 98, reliability: 100 }, rating: 4.9, reviewCount: 212, productCount: 11 },
  { id: '6', slug: 'agneaux-bercé', name: 'Agneaux de la Forêt', commune: 'Jupilles', lat: 47.7411, lng: 0.4533,
    species: ['agneau'], labels: ['AB', 'AOP'],
    scores: { stock: 85, response: 90, reliability: 92 }, rating: 4.5, reviewCount: 48, productCount: 3 },
  { id: '7', slug: 'porcs-haut-sarthe', name: 'Porcs du Haut-Sarthe', commune: 'Fresnay-sur-Sarthe', lat: 48.2839, lng: 0.0194,
    species: ['porc'], labels: ['HVE', 'AB'],
    scores: { stock: 68, response: 55, reliability: 78 }, rating: 4.1, reviewCount: 31, productCount: 5 },
];

const SPECIES_OPTIONS: { value: Species; label: string }[] = [
  { value: 'boeuf', label: 'Bœuf' },
  { value: 'porc', label: 'Porc' },
  { value: 'agneau', label: 'Agneau' },
  { value: 'volaille', label: 'Volaille' },
  { value: 'veau', label: 'Veau' },
];

const LABEL_OPTIONS: { value: LabelCert; label: string }[] = [
  { value: 'AB', label: 'Bio' },
  { value: 'LabelRouge', label: 'Label Rouge' },
  { value: 'HVE', label: 'HVE' },
  { value: 'AOP', label: 'AOP' },
];

const RADIUS_OPTIONS = [10, 25, 50, 100];

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function CartePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [species, setSpecies] = useState<Species[]>(() =>
    (searchParams.get('especes')?.split(',').filter(Boolean) ?? []) as Species[],
  );
  const [labels, setLabels] = useState<LabelCert[]>(() =>
    (searchParams.get('labels')?.split(',').filter(Boolean) ?? []) as LabelCert[],
  );
  const [radius, setRadius] = useState<number>(() =>
    Number(searchParams.get('rayon')) || 50,
  );

  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
    if (species.length) params.set('especes', species.join(','));
    if (labels.length) params.set('labels', labels.join(','));
    if (radius !== 50) params.set('rayon', String(radius));
    const q = params.toString();
    router.replace(q ? `/carte?${q}` : '/carte', { scroll: false });
  }, [species, labels, radius, router]);

  const filtered = useMemo(() => {
    const origin = userLoc ?? LE_MANS;
    return PRODUCERS.map((p) => ({
      ...p,
      distanceKm: haversineKm(origin, { lat: p.lat, lng: p.lng }),
    }))
      .filter((p) => p.distanceKm! <= radius)
      .filter((p) => (species.length === 0 ? true : p.species.some((s) => species.includes(s))))
      .filter((p) => (labels.length === 0 ? true : p.labels.some((l) => labels.includes(l))))
      .sort((a, b) => a.distanceKm! - b.distanceKm!);
  }, [species, labels, radius, userLoc]);

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    if (!mapboxgl.accessToken) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [LE_MANS.lng, LE_MANS.lat],
      zoom: 8.4,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    return () => {
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

    filtered.forEach((p) => {
      const el = document.createElement('button');
      el.className = 'producer-marker';
      el.setAttribute('aria-label', p.name);
      el.style.cssText = `
        width: 36px; height: 36px; border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg); background: #2D6A4F; border: 3px solid #fff;
        box-shadow: 0 4px 12px rgba(27,67,50,0.35); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: transform 180ms, background 180ms;
      `;
      el.innerHTML = `<span style="transform: rotate(45deg); color:#D4841A; font-weight:700; font-size:14px;">${p.productCount}</span>`;

      el.addEventListener('mouseenter', () => setHoveredId(p.id));
      el.addEventListener('mouseleave', () => setHoveredId(null));
      el.addEventListener('click', () => {
        window.location.href = `/producteurs/${p.slug}`;
      });

      const popup = new mapboxgl.Popup({ offset: 30, closeButton: false, className: 'terroir-popup' })
        .setHTML(`
          <div style="font-family: Inter, sans-serif; min-width: 200px;">
            <div style="font-family: 'Cormorant Garamond', serif; font-size: 18px; color: #1B4332; font-weight: 600;">${p.name}</div>
            <div style="font-size: 12px; color: #212529a0; margin-top: 2px;">${p.commune} · ${p.distanceKm!.toFixed(1)} km</div>
            <div style="margin-top: 8px; font-size: 13px; color: #2D6A4F; font-weight: 500;">${p.productCount} produits disponibles →</div>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([p.lng, p.lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current[p.id] = marker;
    });
  }, [filtered]);

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
  const clearAll = () => { setSpecies([]); setLabels([]); setRadius(50); };

  const activeFilters = species.length + labels.length + (radius !== 50 ? 1 : 0);

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <aside className="w-full lg:w-[40%] lg:max-w-[560px] border-r border-dark/[0.06] flex flex-col overflow-hidden">
          <div className="p-6 border-b border-dark/[0.06]">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h1 className="font-serif text-[32px] text-green-900 leading-tight">Carte des éleveurs</h1>
                <p className="text-[13px] text-dark/60 mt-1">
                  {filtered.length} producteur{filtered.length > 1 ? 's' : ''} dans un rayon de {radius} km
                </p>
              </div>
              {locating && <span className="text-[11px] mono text-dark/50">Localisation…</span>}
            </div>
            {locError && <p className="mt-2 text-[12px] text-terra-700">{locError}</p>}
          </div>

          <div className="p-6 border-b border-dark/[0.06] space-y-5 bg-white">
            <FilterGroup label="Espèces">
              <div className="flex flex-wrap gap-1.5">
                {SPECIES_OPTIONS.map((o) => (
                  <Chip key={o.value} active={species.includes(o.value)} onClick={() => toggle(species, o.value, setSpecies)}>
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
            {filtered.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dark/[0.06] p-8 text-center">
                <h3 className="font-serif text-[20px] text-green-900">Aucun producteur</h3>
                <p className="text-[13px] text-dark/60 mt-1">Essayez d'élargir le rayon ou de retirer des filtres.</p>
                <div className="mt-4"><Button variant="secondary" size="sm" onClick={clearAll}>Réinitialiser</Button></div>
              </div>
            ) : (
              filtered.map((p) => (
                <Link
                  key={p.id}
                  href={`/producteurs/${p.slug}`}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`block rounded-2xl transition-all ${hoveredId === p.id ? 'ring-2 ring-terra-300 ring-offset-2 ring-offset-bg' : ''}`}
                >
                  <ProducerCard
                    producer={{
                      name: p.name,
                      commune: p.commune,
                      distanceKm: p.distanceKm,
                      species: p.species,
                      labels: p.labels,
                      scores: p.scores,
                      rating: p.rating,
                      reviewCount: p.reviewCount,
                      productCount: p.productCount,
                    }}
                  />
                </Link>
              ))
            )}
          </div>
        </aside>

        <div className="relative flex-1 min-h-[500px] bg-green-100/40">
          {mapboxgl.accessToken ? (
            <div ref={mapContainer} className="absolute inset-0" />
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
              {userLoc.lat === LE_MANS.lat && userLoc.lng === LE_MANS.lng
                ? 'Le Mans (par défaut)'
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
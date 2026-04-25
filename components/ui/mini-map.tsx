'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

export type MiniMapProps = {
  latitude: number;
  longitude: number;
  markerLabel?: string;
  zoom?: number;
  className?: string;
};

export function MiniMap({
  latitude,
  longitude,
  markerLabel,
  zoom = 11,
  className,
}: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Init one-shot. Coords stables pour la vie du composant (producer fixe
  // sur sa fiche), donc pas de re-init ni de flyTo.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!mapboxgl.accessToken) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [longitude, latitude],
      zoom,
      interactive: false,
      attributionControl: false,
    });
    map.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      'bottom-right',
    );
    mapRef.current = map;

    const el = document.createElement('div');
    el.setAttribute('aria-label', markerLabel ?? 'Localisation');
    el.style.cssText = `
      width: 36px; height: 36px; border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg); background: #2D6A4F; border: 3px solid #fff;
      box-shadow: 0 4px 12px rgba(27,67,50,0.35);
      display: flex; align-items: center; justify-content: center;
    `;
    el.innerHTML = `<span style="transform: rotate(45deg); color:#D4841A; font-weight:700; font-size:14px;">●</span>`;

    new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([longitude, latitude])
      .addTo(map);

    // Backup resize : si le conteneur n'a pas ses dimensions finales à
    // l'init (cascade flex tardive), trackResize rate le 1er trigger.
    const raf = requestAnimationFrame(() => map.resize());
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mapboxgl.accessToken) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-green-100/50 text-[12px] text-dark/50 ${className ?? ''}`}
      >
        Carte indisponible
      </div>
    );
  }

  return <div ref={containerRef} className={`h-full w-full ${className ?? ''}`} />;
}

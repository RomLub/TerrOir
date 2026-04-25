'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import {
  createPinCanvas,
  PIN_DIMENSIONS,
  PIN_TERRA_300,
  PIN_TERRA_500,
} from '@/lib/maps/pin-image';

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

    const pin = createPinCanvas(PIN_TERRA_300, PIN_TERRA_500);
    pin.setAttribute('aria-label', markerLabel ?? 'Localisation');
    pin.setAttribute('role', 'img');
    pin.style.width = `${PIN_DIMENSIONS.width}px`;
    pin.style.height = `${PIN_DIMENSIONS.height}px`;
    pin.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.25))';

    new mapboxgl.Marker({ element: pin, anchor: 'bottom' })
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

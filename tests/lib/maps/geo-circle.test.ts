import { describe, expect, it } from 'vitest';

import { buildCirclePolygon } from '@/lib/maps/geo-circle';

// Vérifie que le polygone généré est cohérent en termes de structure et
// que les points sont à la bonne distance approximative du centre.

const EARTH_RADIUS_KM = 6371;

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

describe('buildCirclePolygon', () => {
  it("retourne un Polygon GeoJSON fermé (1er == dernier point)", () => {
    const poly = buildCirclePolygon(48.0061, 0.1996, 25);
    expect(poly.type).toBe('Polygon');
    expect(poly.coordinates).toHaveLength(1);
    const ring = poly.coordinates[0]!;
    expect(ring.length).toBeGreaterThan(3);
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    expect(first[0]).toBeCloseTo(last[0], 6);
    expect(first[1]).toBeCloseTo(last[1], 6);
  });

  it('place les points à environ radiusKm du centre (±0.5%)', () => {
    const centerLat = 48.0061;
    const centerLng = 0.1996;
    const radiusKm = 25;
    const poly = buildCirclePolygon(centerLat, centerLng, radiusKm);
    const ring = poly.coordinates[0]!;

    for (const [lng, lat] of ring) {
      const distance = haversineKm(centerLat, centerLng, lat, lng);
      // tolérance numérique (sin/cos/asin/atan2) — 0.5% suffit largement
      expect(Math.abs(distance - radiusKm) / radiusKm).toBeLessThan(0.005);
    }
  });

  it('honore le paramètre steps (nombre de segments)', () => {
    const poly = buildCirclePolygon(48, 0, 10, 16);
    // steps=16 → 17 points (boucle fermée : 0..steps inclusif)
    expect(poly.coordinates[0]).toHaveLength(17);
  });
});

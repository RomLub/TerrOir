import { describe, it, expect } from "vitest";
import { haversineKm } from "@/lib/geo/haversine";

const PARIS = { lat: 48.8566, lng: 2.3522 };
const MARSEILLE = { lat: 43.2965, lng: 5.3698 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };

describe("haversineKm", () => {
  it("retourne 0 pour deux points identiques (Paris-Paris)", () => {
    expect(haversineKm(PARIS.lat, PARIS.lng, PARIS.lat, PARIS.lng)).toBe(0);
  });

  it("Paris-Marseille ≈ 660 km (tolérance ±10)", () => {
    const d = haversineKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng);
    expect(d).toBeGreaterThan(650);
    expect(d).toBeLessThan(670);
  });

  it("Paris-New York ≈ 5800 km (tolérance ±50)", () => {
    const d = haversineKm(PARIS.lat, PARIS.lng, NEW_YORK.lat, NEW_YORK.lng);
    expect(d).toBeGreaterThan(5750);
    expect(d).toBeLessThan(5850);
  });

  it("antipodes (0,0) ↔ (0,180) ≈ 20015 km (demi-circonférence terrestre)", () => {
    const d = haversineKm(0, 0, 0, 180);
    expect(d).toBeGreaterThan(19900);
    expect(d).toBeLessThan(20100);
  });

  it("est commutatif : haversineKm(A,B) === haversineKm(B,A)", () => {
    const ab = haversineKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng);
    const ba = haversineKm(MARSEILLE.lat, MARSEILLE.lng, PARIS.lat, PARIS.lng);
    expect(ab).toBe(ba);
  });

  it("retourne un nombre arrondi à 1 décimale", () => {
    const d = haversineKm(PARIS.lat, PARIS.lng, MARSEILLE.lat, MARSEILLE.lng);
    expect(Number.isFinite(d)).toBe(true);
    expect(Math.round(d * 10) / 10).toBe(d);
  });
});

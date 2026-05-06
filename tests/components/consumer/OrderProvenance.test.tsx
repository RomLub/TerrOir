// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrderProvenance } from "@/components/consumer/OrderProvenance";

// T-222 — tests OrderProvenance (D'où vient ma viande)
//
// Mock MiniMap : la vraie version importe mapbox-gl (canvas/WebGL non
// disponibles en jsdom). On ne teste pas le rendu carte ici — c'est un
// composant existant déjà couvert ailleurs. On vérifie : (1) rendu km depuis
// session valide, (2) rendu fallback sans session, (3) rendu hors zone, (4)
// rien si producteur sans coords.

vi.mock("@/components/ui/mini-map", () => ({
  MiniMap: ({ markerLabel }: { markerLabel?: string }) => (
    <div data-testid="mini-map">{markerLabel}</div>
  ),
}));

const SESSION_KEY = "terroir_geo_session";

// Producteur fixture Sarthe (~Le Mans).
const PRODUCER_LAT = 48.0;
const PRODUCER_LNG = 0.2;

// Consumer fictif Paris : ~205 km à vol d'oiseau du producteur Sarthe (sous
// le seuil 500 km DOM-TOM).
const PARIS_LAT = 48.85;
const PARIS_LNG = 2.35;

// Consumer fictif Réunion : ~9000 km, dépasse le seuil 500 km hors zone.
const REUNION_LAT = -21.0;
const REUNION_LNG = 55.5;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OrderProvenance — rendu sans coords producteur (fail-safe)", () => {
  it("ne rend rien si producerLat null", () => {
    const { container } = render(
      <OrderProvenance
        producerName="Ferme Test"
        producerLat={null}
        producerLng={PRODUCER_LNG}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("ne rend rien si producerLng null", () => {
    const { container } = render(
      <OrderProvenance
        producerName="Ferme Test"
        producerLat={PRODUCER_LAT}
        producerLng={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("OrderProvenance — rendu sans session consumer", () => {
  it("affiche carte producteur + message neutre + comparaison ~1500 km", async () => {
    render(
      <OrderProvenance
        producerName="Ferme Test"
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
      />,
    );
    expect(screen.getByTestId("mini-map").textContent).toContain("Ferme Test");
    // Le bloc comparaison ~1500 km est toujours présent (sauf hors zone).
    const ref1500 = await screen.findByText(/~1500 km/);
    expect(ref1500).toBeTruthy();
    // Pas de chiffre km consumer affiché.
    expect(screen.queryByText(/à vol d.oiseau jusqu.à toi/)).toBeNull();
  });
});

describe("OrderProvenance — rendu avec session consumer (post-mount)", () => {
  it("affiche distance km consumer→ferme quand session valide", async () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        lat: PARIS_LAT,
        lng: PARIS_LNG,
        source: "postal",
      }),
    );
    render(
      <OrderProvenance
        producerName="Ferme Test"
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
      />,
    );
    // Distance Haversine Paris → Sarthe ≈ 200 km. On vérifie qu'un km
    // numérique s'affiche bien (pas la valeur exacte — le composant est
    // sensible à toute évolution future de Haversine).
    const phrase = await screen.findByText(/à vol d.oiseau jusqu.à toi/);
    expect(phrase).toBeTruthy();
    expect(phrase.textContent).toContain("Ferme Test");
    // Comparaison 1500 km toujours présente.
    expect(screen.getByText(/~1500 km/)).toBeTruthy();
  });

  it("hors zone : pas de distance brute, message dédié, pas de ~1500 km", async () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        lat: REUNION_LAT,
        lng: REUNION_LNG,
        source: "postal",
      }),
    );
    render(
      <OrderProvenance
        producerName="Ferme Test"
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
      />,
    );
    const phrase = await screen.findByText(
      /en dehors de la zone de circuit court/,
    );
    expect(phrase).toBeTruthy();
    // Pas de "~1500 km" dans le hors zone (ratio s'écraserait).
    expect(screen.queryByText(/~1500 km/)).toBeNull();
  });

  it("ignore session corrompue (lat hors plage WGS84)", async () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ lat: 999, lng: PRODUCER_LNG, source: "postal" }),
    );
    render(
      <OrderProvenance
        producerName="Ferme Test"
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
      />,
    );
    // Session corrompue → comportement = pas de session.
    const ref1500 = await screen.findByText(/~1500 km/);
    expect(ref1500).toBeTruthy();
    expect(screen.queryByText(/à vol d.oiseau jusqu.à toi/)).toBeNull();
  });
});

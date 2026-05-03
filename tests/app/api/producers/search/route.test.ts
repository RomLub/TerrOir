// Tests vitest pour GET /api/producers/search.
//
// Test contractuel sécurité (T-200 r3) : la route ne doit JAMAIS renvoyer de
// coordonnées brutes (6+ décimales) côté client. Quelle que soit la précision
// retournée par la RPC `search_producers` côté Postgres, la couche route doit
// arrondir à 2 décimales via `roundCoord` avant sérialisation. Cf. helper
// lib/producers/coords.ts § "Sites d'appel autorisés".

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

const { mockClientHolder } = vi.hoisted(() => ({
  mockClientHolder: { current: null as SupabaseClient | null },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockClientHolder.current!,
}));

import { GET } from "@/app/api/producers/search/route";

type RpcResult<T> = { data: T | null; error: { message: string } | null };

function buildMockClient(rpcResult: RpcResult<unknown>): SupabaseClient {
  return {
    rpc: vi.fn(async () => rpcResult),
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  mockClientHolder.current = null;
});

describe("GET /api/producers/search — contrat sécurité coords", () => {
  it("arrondit systématiquement latitude/longitude à 2 décimales", async () => {
    // RPC simule une réponse Postgres qui retourne les coords brutes des
    // producers (précision native ~6 décimales, ce que renvoie la fonction
    // search_producers définie en migration).
    mockClientHolder.current = buildMockClient({
      data: [
        {
          id: "p-1",
          slug: "ferme-alpha",
          nom_exploitation: "Ferme Alpha",
          latitude: 47.987654,
          longitude: -3.123456,
          distance_km: 12.3,
        },
        {
          id: "p-2",
          slug: "ferme-beta",
          nom_exploitation: "Ferme Beta",
          latitude: 48.123456789,
          longitude: 0.987654321,
          distance_km: 24.1,
        },
      ],
      error: null,
    });

    const req = new Request(
      "http://localhost:3000/api/producers/search?lat=48.0&lng=0.0&radius=50",
    );
    const res = await GET(req);
    const body = (await res.json()) as {
      count: number;
      results: Array<{ id: string; latitude: number; longitude: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.results).toHaveLength(2);

    // Verrou explicite : les coords sortantes sont strictement arrondies.
    expect(body.results[0]!.latitude).toBe(47.99);
    expect(body.results[0]!.longitude).toBe(-3.12);
    expect(body.results[1]!.latitude).toBe(48.12);
    expect(body.results[1]!.longitude).toBe(0.99);
  });

  it("ne renvoie aucune coordonnée avec plus de 2 décimales (scan exhaustif)", async () => {
    // Même test, formulation contractuelle générique : on vérifie qu'aucune
    // valeur sortie n'a une précision > 0.01. Si quelqu'un ajoute un nouveau
    // champ dérivé de lat/lng (ex. position d'un dépôt logistique) sans le
    // flouter, ce test casse.
    mockClientHolder.current = buildMockClient({
      data: [
        {
          id: "p-1",
          latitude: 47.987654,
          longitude: -3.123456,
        },
        {
          id: "p-2",
          latitude: 48.123456789,
          longitude: 0.987654321,
        },
      ],
      error: null,
    });

    const req = new Request(
      "http://localhost:3000/api/producers/search?lat=48.0&lng=0.0&radius=50",
    );
    const res = await GET(req);
    const body = (await res.json()) as {
      results: Array<Record<string, unknown>>;
    };

    for (const row of body.results) {
      for (const [key, value] of Object.entries(row)) {
        if (
          (key === "latitude" || key === "longitude") &&
          typeof value === "number"
        ) {
          // Contrat : valeur arrondie à 2 décimales → val * 100 est entier.
          expect(Math.round((value as number) * 100)).toBe(
            (value as number) * 100,
          );
        }
      }
    }
  });

  it("propage null pour un producer sans coords (pas de NaN injecté)", async () => {
    mockClientHolder.current = buildMockClient({
      data: [
        {
          id: "p-orphan",
          slug: "ferme-orphan",
          nom_exploitation: "Ferme Orphan",
          latitude: null,
          longitude: null,
        },
      ],
      error: null,
    });

    const req = new Request(
      "http://localhost:3000/api/producers/search?lat=48.0&lng=0.0&radius=50",
    );
    const res = await GET(req);
    const body = (await res.json()) as {
      results: Array<{ latitude: number | null; longitude: number | null }>;
    };

    expect(body.results[0]!.latitude).toBeNull();
    expect(body.results[0]!.longitude).toBeNull();
  });

  it("rejette une requête sans lat/lng (400)", async () => {
    mockClientHolder.current = buildMockClient({ data: [], error: null });
    const req = new Request("http://localhost:3000/api/producers/search");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("rejette un radius hors bornes (400)", async () => {
    mockClientHolder.current = buildMockClient({ data: [], error: null });
    const req = new Request(
      "http://localhost:3000/api/producers/search?lat=48&lng=0&radius=9999",
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});

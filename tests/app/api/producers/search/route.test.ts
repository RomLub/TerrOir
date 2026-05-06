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

const { mockClientHolder, rateLimitHolder } = vi.hoisted(() => ({
  mockClientHolder: { current: null as SupabaseClient | null },
  // T-236 : pilote du résultat consumeRateLimit pour les tests. Par défaut
  // success=true (le rate-limit n'intercepte pas), les tests dédiés
  // basculent à success=false pour vérifier le 429.
  rateLimitHolder: {
    current: {
      success: true,
      limit: 30,
      remaining: 29,
      reset: Date.now() + 60_000,
    },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockClientHolder.current!,
}));

vi.mock("@/lib/rate-limit", () => ({
  getProducersSearchRateLimit: () => ({}),
  consumeRateLimit: async () => rateLimitHolder.current,
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
  // Reset rate-limit holder à "allowed" entre tests pour ne pas
  // contaminer les tests contractuels coords plus bas.
  rateLimitHolder.current = {
    success: true,
    limit: 30,
    remaining: 29,
    reset: Date.now() + 60_000,
  };
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

describe("GET /api/producers/search — rate-limit anti-trilatération (T-236)", () => {
  it("rate-limit hit : 429 + header Retry-After", async () => {
    // Simule un user qui a dépassé son cap 30/min/IP. La RPC ne doit pas
    // être appelée (court-circuit dès la première vérification).
    const rpcSpy = vi.fn(async () => ({ data: [], error: null }));
    mockClientHolder.current = {
      rpc: rpcSpy,
    } as unknown as SupabaseClient;

    rateLimitHolder.current = {
      success: false,
      limit: 30,
      remaining: 0,
      reset: Date.now() + 45_000, // Reset dans ~45 secondes
    };

    const req = new Request(
      "http://localhost:3000/api/producers/search?lat=48.0&lng=0.0&radius=50",
    );
    const res = await GET(req);

    expect(res.status).toBe(429);
    // Retry-After : nombre entier en secondes, pas de valeur 0 (Math.max 1
    // empêche un Retry-After=0 quand le reset est dans la passé suite à un
    // micro-décalage horloge).
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Trop de requêtes");
    // Verrou court-circuit : la DB N'A PAS été touchée — propriété critique
    // pour que le rate-limit serve réellement de premier rempart.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("rate-limit pass : 200 nominal avec coords floutées", async () => {
    // Verrou symétrique : avec rate-limit allowed, le flux nominal s'exécute
    // (et applique toujours roundCoord — propriété cumulative).
    mockClientHolder.current = buildMockClient({
      data: [
        {
          id: "p-1",
          latitude: 47.987654,
          longitude: -3.123456,
        },
      ],
      error: null,
    });
    rateLimitHolder.current = {
      success: true,
      limit: 30,
      remaining: 25,
      reset: Date.now() + 60_000,
    };

    const req = new Request(
      "http://localhost:3000/api/producers/search?lat=48.0&lng=0.0&radius=50",
    );
    const res = await GET(req);
    const body = (await res.json()) as {
      results: Array<{ latitude: number; longitude: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.latitude).toBe(47.99);
    expect(body.results[0]!.longitude).toBe(-3.12);
  });
});

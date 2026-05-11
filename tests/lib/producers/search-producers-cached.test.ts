// Tests vitest pour `lib/producers/search-producers-cached.ts`.
//
// F-021 (audit pré-launch 2026-05 + verification 2026-05-11) — wrapper
// `unstable_cache` autour de la RPC `search_producers`. Couverture :
//
//   1. `buildSearchProducersCacheKey` est déterministe pour params identiques
//      (deux calls successifs → même clé ; condition nécessaire au cache hit).
//   2. La clé varie sur les axes attendus (lat/lng quantifiés à 1 décimale,
//      radius, filtres multi-select).
//   3. L'ordre lexico des filtres ne change pas la clé (cache hit robuste à
//      l'ordre dans l'UI).
//   4. La quantization à 1 décimale est correcte (47.123 → 47.1).
//   5. La RPC est appelée avec les coords quantifiées (trade-off précision
//      explicit dans le wrapper).
//   6. Cache hit observable : avec `unstable_cache` réel + même clé, la RPC
//      sous-jacente n'est appelée qu'une fois (mock `next/cache` désactivé).
//   7. Cache miss observable : params différents (radius différent) → 2 calls
//      RPC distincts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// En contexte test, on bypass `unstable_cache` par défaut (pass-through).
// Les tests "cache hit" / "cache miss" ré-installent un mock dédié qui
// simule le caching par clé (Map en mémoire).
vi.mock("next/cache", () => ({
  unstable_cache: <Fn extends (...args: unknown[]) => unknown>(fn: Fn) => fn,
  revalidateTag: vi.fn(),
}));

import {
  buildSearchProducersCacheKey,
  fetchSearchProducersCached,
} from "@/lib/producers/search-producers-cached";

type RpcCall = { name: string; args: Record<string, unknown> };

function buildCapturingClient(): {
  client: SupabaseClient;
  rpcCalls: RpcCall[];
} {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: [], error: null };
    }),
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

const baseParams = {
  lat: 47.987,
  lng: 0.123,
  radius_km: 50,
  especes: null,
  labels: null,
  mode_elevage: null,
  alimentation: null,
  densite_animale: null,
};

describe("buildSearchProducersCacheKey", () => {
  it("renvoie une clé identique pour deux appels avec les mêmes params", () => {
    const k1 = buildSearchProducersCacheKey({ ...baseParams });
    const k2 = buildSearchProducersCacheKey({ ...baseParams });
    expect(k1).toEqual(k2);
  });

  it("quantifie lat/lng à 1 décimale (~11 km en latitude)", () => {
    const k1 = buildSearchProducersCacheKey({
      ...baseParams,
      lat: 47.123,
      lng: 0.456,
    });
    // bin attendu : 47.1 / 0.5
    expect(k1).toContain("lat=47.1");
    expect(k1).toContain("lng=0.5");
  });

  it("regroupe deux coordonnées dans la même bin de 1 décimale", () => {
    // Deux visiteurs dans le même bassin de vie (~5 km l'un de l'autre)
    // partagent la même entrée de cache — c'est le but de la stratégie.
    const k1 = buildSearchProducersCacheKey({
      ...baseParams,
      lat: 47.91,
      lng: 0.21,
    });
    const k2 = buildSearchProducersCacheKey({
      ...baseParams,
      lat: 47.94,
      lng: 0.18,
    });
    // 47.91 → 47.9 ; 47.94 → 47.9 ; 0.21 → 0.2 ; 0.18 → 0.2.
    expect(k1).toEqual(k2);
  });

  it("varie sur le rayon", () => {
    const k1 = buildSearchProducersCacheKey({ ...baseParams, radius_km: 50 });
    const k2 = buildSearchProducersCacheKey({ ...baseParams, radius_km: 100 });
    expect(k1).not.toEqual(k2);
  });

  it("est insensible à l'ordre des filtres multi-select (tri lexico)", () => {
    const k1 = buildSearchProducersCacheKey({
      ...baseParams,
      especes: ["bovin", "ovin"],
      labels: ["bio", "fermier"],
    });
    const k2 = buildSearchProducersCacheKey({
      ...baseParams,
      especes: ["ovin", "bovin"],
      labels: ["fermier", "bio"],
    });
    expect(k1).toEqual(k2);
  });

  it("varie quand un filtre multi-select est ajouté", () => {
    const k1 = buildSearchProducersCacheKey({
      ...baseParams,
      mode_elevage: ["plein_air"],
    });
    const k2 = buildSearchProducersCacheKey({
      ...baseParams,
      mode_elevage: ["plein_air", "semi_plein_air"],
    });
    expect(k1).not.toEqual(k2);
  });

  it("distingue NULL et liste vide via marker '_'", () => {
    // NULL et [] collapsent au même marker '_' (pas de filtre, pas de
    // calcul). Cohérent avec l'API RPC qui traite les deux pareil.
    const k1 = buildSearchProducersCacheKey({ ...baseParams, especes: null });
    const k2 = buildSearchProducersCacheKey({ ...baseParams, especes: [] });
    expect(k1).toEqual(k2);
  });
});

describe("fetchSearchProducersCached — RPC integration (cache bypass)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appelle la RPC avec les coords quantifiées (trade-off précision)", async () => {
    const { client, rpcCalls } = buildCapturingClient();
    await fetchSearchProducersCached(client, {
      ...baseParams,
      lat: 47.987654,
      lng: 0.123456,
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.name).toBe("search_producers");
    expect(rpcCalls[0]!.args.p_lat).toBe(48.0);
    expect(rpcCalls[0]!.args.p_lng).toBe(0.1);
    // Les autres params sont propagés tels quels.
    expect(rpcCalls[0]!.args.p_radius_km).toBe(50);
    expect(rpcCalls[0]!.args.p_especes).toBeNull();
  });

  it("propage les filtres multi-select au RPC sans tri (DB-side sémantique)", async () => {
    const { client, rpcCalls } = buildCapturingClient();
    await fetchSearchProducersCached(client, {
      ...baseParams,
      especes: ["bovin", "ovin"],
      labels: ["bio"],
      mode_elevage: ["plein_air"],
    });
    expect(rpcCalls[0]!.args.p_especes).toEqual(["bovin", "ovin"]);
    expect(rpcCalls[0]!.args.p_labels).toEqual(["bio"]);
    expect(rpcCalls[0]!.args.p_mode_elevage).toEqual(["plein_air"]);
  });

  it("propage l'erreur PostgREST sans throw (signature stable pour la route)", async () => {
    const client = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: "boom", code: "42P01" },
      })),
    } as unknown as SupabaseClient;
    const result = await fetchSearchProducersCached(client, { ...baseParams });
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: "boom", code: "42P01" });
  });

  it("retourne un tableau vide quand la RPC renvoie null data", async () => {
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
    } as unknown as SupabaseClient;
    const result = await fetchSearchProducersCached(client, { ...baseParams });
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });
});

describe("fetchSearchProducersCached — cache hit / miss simulé", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("cache hit : 2e call avec même clé ne ré-appelle pas la RPC", async () => {
    // Mock dédié qui simule un vrai cache par clé via Map module-scoped.
    vi.doMock("next/cache", () => {
      const memo = new Map<string, unknown>();
      return {
        revalidateTag: vi.fn(),
        unstable_cache: <Fn extends (...args: unknown[]) => unknown>(
          fn: Fn,
          keyParts: string[],
        ) => {
          const key = JSON.stringify(keyParts);
          return (async (...args: unknown[]) => {
            if (memo.has(key)) return memo.get(key) as ReturnType<Fn>;
            const result = await fn(...args);
            memo.set(key, result);
            return result;
          }) as unknown as Fn;
        },
      };
    });

    const mod = await import("@/lib/producers/search-producers-cached");
    const { client, rpcCalls } = buildCapturingClient();

    await mod.fetchSearchProducersCached(client, { ...baseParams });
    await mod.fetchSearchProducersCached(client, { ...baseParams });

    expect(rpcCalls).toHaveLength(1);
  });

  it("cache miss : params différents → 2 calls RPC distincts", async () => {
    vi.doMock("next/cache", () => {
      const memo = new Map<string, unknown>();
      return {
        revalidateTag: vi.fn(),
        unstable_cache: <Fn extends (...args: unknown[]) => unknown>(
          fn: Fn,
          keyParts: string[],
        ) => {
          const key = JSON.stringify(keyParts);
          return (async (...args: unknown[]) => {
            if (memo.has(key)) return memo.get(key) as ReturnType<Fn>;
            const result = await fn(...args);
            memo.set(key, result);
            return result;
          }) as unknown as Fn;
        },
      };
    });

    const mod = await import("@/lib/producers/search-producers-cached");
    const { client, rpcCalls } = buildCapturingClient();

    await mod.fetchSearchProducersCached(client, {
      ...baseParams,
      radius_km: 50,
    });
    await mod.fetchSearchProducersCached(client, {
      ...baseParams,
      radius_km: 100,
    });

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0]!.args.p_radius_km).toBe(50);
    expect(rpcCalls[1]!.args.p_radius_km).toBe(100);
  });

  it("cache hit cross-bin : deux coords dans la même bin 1 décimale → 1 call RPC", async () => {
    vi.doMock("next/cache", () => {
      const memo = new Map<string, unknown>();
      return {
        revalidateTag: vi.fn(),
        unstable_cache: <Fn extends (...args: unknown[]) => unknown>(
          fn: Fn,
          keyParts: string[],
        ) => {
          const key = JSON.stringify(keyParts);
          return (async (...args: unknown[]) => {
            if (memo.has(key)) return memo.get(key) as ReturnType<Fn>;
            const result = await fn(...args);
            memo.set(key, result);
            return result;
          }) as unknown as Fn;
        },
      };
    });

    const mod = await import("@/lib/producers/search-producers-cached");
    const { client, rpcCalls } = buildCapturingClient();

    // Deux visiteurs séparés de ~5 km — même bin → cache hit.
    await mod.fetchSearchProducersCached(client, {
      ...baseParams,
      lat: 47.91,
      lng: 0.21,
    });
    await mod.fetchSearchProducersCached(client, {
      ...baseParams,
      lat: 47.94,
      lng: 0.18,
    });

    expect(rpcCalls).toHaveLength(1);
  });
});

describe("revalidateProducersSearch — invalidation tag", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("appelle revalidateTag('producers-search', 'max')", async () => {
    const revalidateTagMock = vi.fn();
    vi.doMock("next/cache", () => ({
      unstable_cache: <Fn extends (...args: unknown[]) => unknown>(fn: Fn) => fn,
      revalidateTag: revalidateTagMock,
    }));

    const mod = await import("@/lib/stats/revalidate");
    await mod.revalidateProducersSearch({
      source: "test",
      producerId: "p-xyz",
    });

    expect(revalidateTagMock).toHaveBeenCalledWith("producers-search", "max");
  });
});

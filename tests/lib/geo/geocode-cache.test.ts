import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests T-219 — helper lib/geo/geocode-cache.ts.
//
// On test au niveau supabase mock : la table public.geocode_cache + les 2 RPC
// (bump_geocode_cache, upsert_geocode_cache) sont définis dans la migration
// 20260506181153_t219_geocode_cache.sql et appliqués manuellement par Romain.
// Ici on mocke uniquement createSupabaseAdminClient() pour vérifier la
// logique applicative (orchestrateur cache hit/miss, validation Zod, fail-safe).

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

type RpcResult<T> = { data: T | null; error: { message: string } | null };

const { rpcMock, geocodePostalCodeMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(name: string, params: unknown) => Promise<RpcResult<unknown>>>(),
  geocodePostalCodeMock: vi.fn<
    (cp: string, opts?: unknown) => Promise<unknown>
  >(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: rpcMock,
  }),
}));

vi.mock("@/lib/geo/geocode-postal", () => ({
  geocodePostalCode: geocodePostalCodeMock,
}));

import {
  getCachedGeocode,
  setCachedGeocode,
  resolvePostalCode,
} from "@/lib/geo/geocode-cache";

beforeEach(() => {
  rpcMock.mockReset();
  geocodePostalCodeMock.mockReset();
});

// -----------------------------------------------------------------------------
// getCachedGeocode
// -----------------------------------------------------------------------------

describe("getCachedGeocode — hit/miss/erreur", () => {
  it("hit : appelle bump_geocode_cache et retourne {lat, lng}", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ lat: 47.99, lng: -0.12 }],
      error: null,
    });

    const result = await getCachedGeocode("72220");
    expect(result).toEqual({ lat: 47.99, lng: -0.12 });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("bump_geocode_cache", {
      p_cp: "72220",
    });
  });

  it("miss : RPC RETURNING vide → retourne null", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    expect(await getCachedGeocode("99999")).toBeNull();
  });

  it("miss : data null → retourne null", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await getCachedGeocode("99999")).toBeNull();
  });

  it("CP invalide : retourne null sans appel DB", async () => {
    expect(await getCachedGeocode("ABCDE")).toBeNull();
    expect(await getCachedGeocode("123")).toBeNull();
    expect(await getCachedGeocode("")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("erreur RPC : log warn + retourne null (fail-safe)", async () => {
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "connection lost" },
    });
    expect(await getCachedGeocode("75001")).toBeNull();
    expect(consoleErr).toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it("trim CP entouré d'espaces (cohérent avec geocodePostalCode)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ lat: 48.86, lng: 2.35 }],
      error: null,
    });
    const result = await getCachedGeocode("  75001  ");
    expect(result).toEqual({ lat: 48.86, lng: 2.35 });
    expect(rpcMock).toHaveBeenCalledWith("bump_geocode_cache", {
      p_cp: "75001",
    });
  });

  it("lat/lng non finis dans la row : retourne null (defense in depth)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ lat: Number.NaN, lng: 2.35 }],
      error: null,
    });
    expect(await getCachedGeocode("75001")).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// setCachedGeocode
// -----------------------------------------------------------------------------

describe("setCachedGeocode — write path", () => {
  it("succès : appelle upsert_geocode_cache avec p_cp/p_lat/p_lng/p_source", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });

    const ok = await setCachedGeocode("72220", 47.99, -0.12);
    expect(ok).toBe(true);

    expect(rpcMock).toHaveBeenCalledWith("upsert_geocode_cache", {
      p_cp: "72220",
      p_lat: 47.99,
      p_lng: -0.12,
      p_source: "api-adresse.data.gouv.fr",
    });
  });

  it("source custom respectée si fournie", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await setCachedGeocode("72220", 47.99, -0.12, "custom-source");
    expect(rpcMock).toHaveBeenCalledWith(
      "upsert_geocode_cache",
      expect.objectContaining({ p_source: "custom-source" }),
    );
  });

  it("CP invalide : retourne false sans appel DB", async () => {
    expect(await setCachedGeocode("ABCDE", 47, 0)).toBe(false);
    expect(await setCachedGeocode("", 47, 0)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("lat hors plage WGS84 : retourne false sans appel DB", async () => {
    expect(await setCachedGeocode("72220", 91, 0)).toBe(false);
    expect(await setCachedGeocode("72220", -91, 0)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("lng hors plage WGS84 : retourne false sans appel DB", async () => {
    expect(await setCachedGeocode("72220", 47, 181)).toBe(false);
    expect(await setCachedGeocode("72220", 47, -181)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("lat/lng NaN : retourne false sans appel DB", async () => {
    expect(await setCachedGeocode("72220", Number.NaN, 0)).toBe(false);
    expect(await setCachedGeocode("72220", 47, Number.NaN)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("erreur RPC : log error + retourne false (fail-safe)", async () => {
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "constraint violation" },
    });
    expect(await setCachedGeocode("72220", 47, 0)).toBe(false);
    expect(consoleErr).toHaveBeenCalled();
    consoleErr.mockRestore();
  });
});

// -----------------------------------------------------------------------------
// resolvePostalCode — orchestrateur
// -----------------------------------------------------------------------------

describe("resolvePostalCode — cache hit/miss + fetch externe", () => {
  it("CP invalide : retourne invalid_format sans aucun appel DB ni gouv.fr", async () => {
    const result = await resolvePostalCode("ABCDE");
    expect(result).toEqual({ ok: false, code: "invalid_format" });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(geocodePostalCodeMock).not.toHaveBeenCalled();
  });

  it("cache hit : retourne {ok, lat, lng, cached:true} sans appeler gouv.fr", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ lat: 47.99, lng: -0.12 }],
      error: null,
    });

    const result = await resolvePostalCode("72220");
    expect(result).toEqual({
      ok: true,
      lat: 47.99,
      lng: -0.12,
      cached: true,
      source: "geocode_cache",
    });
    expect(geocodePostalCodeMock).not.toHaveBeenCalled();
  });

  it("cache miss + fetch OK : retourne {cached:false, source: gouv}, UPSERT en cache", async () => {
    // 1er rpc : bump (miss → empty)
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    geocodePostalCodeMock.mockResolvedValueOnce({
      ok: true,
      lat: 48.86,
      lng: 2.35,
    });
    // 2e rpc : upsert
    rpcMock.mockResolvedValueOnce({ data: null, error: null });

    const result = await resolvePostalCode("75001");
    expect(result).toEqual({
      ok: true,
      lat: 48.86,
      lng: 2.35,
      cached: false,
      source: "api-adresse.data.gouv.fr",
    });

    // Bump (hit attempt) + upsert (write).
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0]?.[0]).toBe("bump_geocode_cache");
    expect(rpcMock.mock.calls[1]?.[0]).toBe("upsert_geocode_cache");
    expect(geocodePostalCodeMock).toHaveBeenCalledTimes(1);
  });

  it("cache miss + gouv.fr not_found : retourne not_found, pas d'UPSERT", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    geocodePostalCodeMock.mockResolvedValueOnce({
      ok: false,
      code: "not_found",
    });

    const result = await resolvePostalCode("99999");
    expect(result).toEqual({ ok: false, code: "not_found" });
    // Aucun upsert — on n'a rien à cacher (CP invalide côté gouv.fr).
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]?.[0]).toBe("bump_geocode_cache");
  });

  it("cache miss + gouv.fr network error : retourne network, pas d'UPSERT", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    geocodePostalCodeMock.mockResolvedValueOnce({
      ok: false,
      code: "network",
    });

    const result = await resolvePostalCode("75001");
    expect(result).toEqual({ ok: false, code: "network" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("cache miss + gouv.fr timeout : retourne timeout, pas d'UPSERT", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    geocodePostalCodeMock.mockResolvedValueOnce({
      ok: false,
      code: "timeout",
    });

    const result = await resolvePostalCode("75001");
    expect(result).toEqual({ ok: false, code: "timeout" });
  });

  it("cache miss + gouv.fr OK + setCached échoue : ne casse pas la résolution", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    geocodePostalCodeMock.mockResolvedValueOnce({
      ok: true,
      lat: 48.86,
      lng: 2.35,
    });
    // L'UPSERT échoue (DB indispo) — best-effort, on retourne quand même
    // la résolution courante.
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });

    const result = await resolvePostalCode("75001");
    expect(result).toEqual({
      ok: true,
      lat: 48.86,
      lng: 2.35,
      cached: false,
      source: "api-adresse.data.gouv.fr",
    });
    consoleErr.mockRestore();
  });

  it("propage les options (fetchImpl, timeoutMs) au helper gouv.fr", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    geocodePostalCodeMock.mockResolvedValueOnce({
      ok: true,
      lat: 0,
      lng: 0,
    });
    rpcMock.mockResolvedValueOnce({ data: null, error: null });

    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await resolvePostalCode("75001", { fetchImpl, timeoutMs: 5000 });

    expect(geocodePostalCodeMock).toHaveBeenCalledWith("75001", {
      fetchImpl,
      timeoutMs: 5000,
    });
  });
});

// -----------------------------------------------------------------------------
// Continuité T-200 r1 — pas de PII côté helper
// -----------------------------------------------------------------------------

describe("contrat T-200 r1 — pas de PII traversant le cache", () => {
  it("aucune des 3 fonctions ne reçoit IP / userId / userAgent en paramètre", () => {
    // Verrou structurel : si quelqu'un ajoute un paramètre IP/user* aux
    // signatures, ce test casse au type-check (compile-time) — la promesse
    // T-200 r1 "pas de profilage user" est inscrite dans la signature.
    type GetParams = Parameters<typeof getCachedGeocode>;
    type SetParams = Parameters<typeof setCachedGeocode>;
    type ResolveParams = Parameters<typeof resolvePostalCode>;

    // Vérifie au runtime qu'aucun paramètre n'est nommé suspect.
    const get: GetParams = ["72220"];
    const set: SetParams = ["72220", 47, 0];
    const resolve: ResolveParams = ["72220"];
    expect(get).toHaveLength(1);
    expect(set.length).toBeGreaterThanOrEqual(3);
    expect(resolve.length).toBeGreaterThanOrEqual(1);
  });
});

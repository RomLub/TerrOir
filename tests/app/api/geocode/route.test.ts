import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests T-219 — route GET /api/geocode.
//
// On mock resolvePostalCode (déjà testé unitairement dans
// tests/lib/geo/geocode-cache.test.ts) et le rate-limiter pour exercer
// uniquement la couche route (validation querystring, mapping erreurs →
// codes HTTP, headers Cache-Control, contrat continuité T-200 r1).

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

const { resolvePostalCodeMock, consumeRateLimitMock, getGeocodeRateLimitMock } =
  vi.hoisted(() => ({
    resolvePostalCodeMock: vi.fn(),
    consumeRateLimitMock: vi.fn(),
    getGeocodeRateLimitMock: vi.fn(() => ({}) as object),
  }));

vi.mock("@/lib/geo/geocode-cache", () => ({
  resolvePostalCode: resolvePostalCodeMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: consumeRateLimitMock,
  getGeocodeRateLimit: getGeocodeRateLimitMock,
}));

import { GET } from "@/app/api/geocode/route";

beforeEach(() => {
  resolvePostalCodeMock.mockReset();
  consumeRateLimitMock.mockReset();
  // Default : rate-limit OK (success=true)
  consumeRateLimitMock.mockResolvedValue({
    success: true,
    limit: 30,
    remaining: 29,
    reset: 0,
  });
});

function makeReq(qs: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/geocode${qs}`, { headers });
}

// -----------------------------------------------------------------------------
// Validation CP (Zod)
// -----------------------------------------------------------------------------

describe("GET /api/geocode — validation CP", () => {
  it("CP absent : 400 invalid_format, aucun appel resolvePostalCode", async () => {
    const res = await GET(makeReq(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: "invalid_format" });
    expect(resolvePostalCodeMock).not.toHaveBeenCalled();
  });

  it("CP non-numérique : 400 invalid_format", async () => {
    const res = await GET(makeReq("?cp=ABCDE"));
    expect(res.status).toBe(400);
    expect(resolvePostalCodeMock).not.toHaveBeenCalled();
  });

  it("CP trop court : 400 invalid_format", async () => {
    const res = await GET(makeReq("?cp=123"));
    expect(res.status).toBe(400);
  });

  it("CP avec injection : 400 (regex bloque AVANT l'appel résolveur)", async () => {
    const res = await GET(makeReq("?cp=75001%3BDROP"));
    expect(res.status).toBe(400);
    expect(resolvePostalCodeMock).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Happy path cache hit / cache miss
// -----------------------------------------------------------------------------

describe("GET /api/geocode — happy path", () => {
  it("cache hit : 200 + body cached:true + Cache-Control 30 jours", async () => {
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: true,
      lat: 47.99,
      lng: -0.12,
      cached: true,
      source: "geocode_cache",
    });

    const res = await GET(makeReq("?cp=72220"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      lat: 47.99,
      lng: -0.12,
      cached: true,
      source: "geocode_cache",
    });
    // Cache HTTP 30 jours (defense in depth, cohérent persistance DB).
    expect(res.headers.get("Cache-Control")).toContain("public");
    expect(res.headers.get("Cache-Control")).toContain("max-age=2592000");
  });

  it("cache miss + fetch OK : 200 + body cached:false + Cache-Control 30 jours", async () => {
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: true,
      lat: 48.86,
      lng: 2.35,
      cached: false,
      source: "api-adresse.data.gouv.fr",
    });

    const res = await GET(makeReq("?cp=75001"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.source).toBe("api-adresse.data.gouv.fr");
    expect(res.headers.get("Cache-Control")).toContain("max-age=2592000");
  });
});

// -----------------------------------------------------------------------------
// Erreurs upstream
// -----------------------------------------------------------------------------

describe("GET /api/geocode — erreurs upstream", () => {
  it("not_found côté résolveur : 404", async () => {
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: false,
      code: "not_found",
    });
    const res = await GET(makeReq("?cp=99999"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: "not_found" });
  });

  it("network côté résolveur : 502 upstream_unavailable", async () => {
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: false,
      code: "network",
    });
    const res = await GET(makeReq("?cp=75001"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: "upstream_unavailable" });
  });

  it("timeout côté résolveur : 502 upstream_unavailable", async () => {
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: false,
      code: "timeout",
    });
    const res = await GET(makeReq("?cp=75001"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_unavailable");
  });

  it("db_error côté résolveur : 502 upstream_unavailable (cache miss + DB indispo)", async () => {
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: false,
      code: "db_error",
    });
    const res = await GET(makeReq("?cp=75001"));
    expect(res.status).toBe(502);
  });
});

// -----------------------------------------------------------------------------
// Rate-limit
// -----------------------------------------------------------------------------

describe("GET /api/geocode — rate-limit Upstash", () => {
  it("rate-limit hit : 429 rate_limited, aucun appel résolveur", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 30,
      remaining: 0,
      reset: 0,
    });
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const res = await GET(
      makeReq("?cp=75001", { "x-forwarded-for": "1.2.3.4" }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: "rate_limited" });
    expect(resolvePostalCodeMock).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("rate-limit identifier = IP via x-forwarded-for", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: true,
      limit: 30,
      remaining: 29,
      reset: 0,
    });
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: true,
      lat: 0,
      lng: 0,
      cached: true,
      source: "geocode_cache",
    });

    await GET(makeReq("?cp=75001", { "x-forwarded-for": "1.2.3.4" }));

    expect(consumeRateLimitMock).toHaveBeenCalledTimes(1);
    // Le 2e arg de consumeRateLimit est l'identifier — l'IP du x-forwarded-for.
    expect(consumeRateLimitMock.mock.calls[0]?.[1]).toBe("1.2.3.4");
  });

  it("pas d'IP : identifier 'anon-no-ip' (cohérent contact route)", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      success: true,
      limit: 30,
      remaining: 29,
      reset: 0,
    });
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: true,
      lat: 0,
      lng: 0,
      cached: true,
      source: "geocode_cache",
    });

    await GET(makeReq("?cp=75001"));

    expect(consumeRateLimitMock.mock.calls[0]?.[1]).toBe("anon-no-ip");
  });
});

// -----------------------------------------------------------------------------
// Continuité T-200 r1 — pas de log applicatif par-IP / par-User
// -----------------------------------------------------------------------------

describe("contrat T-200 r1 — pas de log applicatif par-IP / par-User", () => {
  it("succès : aucun appel à audit_logs (pas d'event tracking)", async () => {
    // Verrou structurel : la route ne doit PAS importer createSupabaseAdminClient
    // pour faire un INSERT audit_logs (cohérent avec /api/contact qui le fait
    // côté contact form, mais /api/geocode ne doit JAMAIS, cf. T-200 r1).
    // Le simple fait que les tests précédents passent sans mock audit_logs
    // prouve qu'il n'y a aucun appel — mais on verrouille explicitement ici.
    resolvePostalCodeMock.mockResolvedValueOnce({
      ok: true,
      lat: 0,
      lng: 0,
      cached: true,
      source: "geocode_cache",
    });

    // Si la route appelait createSupabaseAdminClient ou audit log, le test
    // exploserait avec une erreur de mock manquant. On vérifie aussi que
    // resolvePostalCode est appelé sans aucun argument suspect (IP, userId).
    await GET(
      makeReq("?cp=75001", {
        "x-forwarded-for": "1.2.3.4",
        "user-agent": "Mozilla/5.0 ScraperBot",
      }),
    );

    expect(resolvePostalCodeMock).toHaveBeenCalledTimes(1);
    // Le seul argument passé doit être le CP — pas de second arg avec IP/UA.
    const callArgs = resolvePostalCodeMock.mock.calls[0];
    expect(callArgs?.[0]).toBe("75001");
    // Le 2e arg est optionnel (options fetchImpl/timeoutMs) — vérifier qu'il
    // ne contient JAMAIS une clé suspecte si présent.
    const opts = callArgs?.[1] as Record<string, unknown> | undefined;
    if (opts) {
      expect(opts).not.toHaveProperty("ipAddress");
      expect(opts).not.toHaveProperty("userId");
      expect(opts).not.toHaveProperty("userAgent");
    }
  });
});

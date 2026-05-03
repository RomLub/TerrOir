import { describe, it, expect, vi } from "vitest";
import {
  geocodePostalCode,
  GEOCODE_POSTAL_ERROR_MESSAGES,
} from "@/lib/geo/geocode-postal";

// Le helper appelle api-adresse.data.gouv.fr DIRECTEMENT depuis le navigateur
// du visiteur (cf. DistanceWidget). Aucune route TerrOir ne proxy l'appel
// → pas de risque SSRF, pas de logs serveur. La validation regex ^\d{5}$
// AVANT l'appel réseau est la seule barrière contre une URL détournée.

function fetchOk(payload: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

function fetchHttpError(status: number): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

function fetchNetworkError(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
}

describe("geocodePostalCode — validation format CP", () => {
  it("rejette un CP non-numérique → invalid_format, aucun appel réseau", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await geocodePostalCode("ABCDE", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "invalid_format" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejette un CP trop court → invalid_format", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await geocodePostalCode("750", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "invalid_format" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejette un CP avec injection (sécurité — empêche détournement URL)", async () => {
    // Tentative d'injection : caractères qui détourneraient l'URL si la
    // regex n'était pas appliquée AVANT l'appel réseau. Le whitespace en
    // début/fin est acceptable (trim UX) — on teste ici uniquement les
    // payloads malveillants qui contiennent des caractères non numériques.
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const malicious of [
      "75001&q=evil",
      "75001;DROP",
      "../../etc/passwd",
      "75001%00",
      "75001​",
    ]) {
      const res = await geocodePostalCode(malicious, { fetchImpl });
      expect(res.ok).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("trim un CP entouré d'espaces (UX tolérance)", async () => {
    const fetchImpl = fetchOk({
      features: [{ geometry: { coordinates: [2.35, 48.86] } }],
    });
    const res = await geocodePostalCode("  75001  ", { fetchImpl });
    expect(res).toEqual({ ok: true, lat: 48.86, lng: 2.35 });
  });
});

describe("geocodePostalCode — happy path", () => {
  it("retourne { ok: true, lat, lng } pour un CP valide", async () => {
    const fetchImpl = fetchOk({
      features: [{ geometry: { coordinates: [2.3522, 48.8566] } }],
    });
    const res = await geocodePostalCode("75001", { fetchImpl });
    expect(res).toEqual({ ok: true, lat: 48.8566, lng: 2.3522 });
  });

  it("appelle l'endpoint api-adresse.data.gouv.fr avec type=municipality", async () => {
    const fetchImpl = fetchOk({
      features: [{ geometry: { coordinates: [0, 0] } }],
    });
    await geocodePostalCode("72000", { fetchImpl });
    const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = String(call?.[0] ?? "");
    expect(url).toContain("api-adresse.data.gouv.fr");
    expect(url).toContain("q=72000");
    expect(url).toContain("type=municipality");
    expect(url).toContain("limit=1");
  });
});

describe("geocodePostalCode — branches d'erreur", () => {
  it("payload sans feature → not_found", async () => {
    const fetchImpl = fetchOk({ features: [] });
    const res = await geocodePostalCode("99999", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });

  it("payload sans coordinates → not_found", async () => {
    const fetchImpl = fetchOk({ features: [{ geometry: {} }] });
    const res = await geocodePostalCode("75001", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });

  it("coordinates non-finies → not_found (defense in depth)", async () => {
    const fetchImpl = fetchOk({
      features: [{ geometry: { coordinates: [NaN, NaN] } }],
    });
    const res = await geocodePostalCode("75001", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });

  it("HTTP 500 côté API gouv → network", async () => {
    const fetchImpl = fetchHttpError(500);
    const res = await geocodePostalCode("75001", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "network" });
  });

  it("HTTP 429 (rate-limit gouv) → network", async () => {
    const fetchImpl = fetchHttpError(429);
    const res = await geocodePostalCode("75001", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "network" });
  });

  it("réseau coupé / fetch throw → network", async () => {
    const fetchImpl = fetchNetworkError();
    const res = await geocodePostalCode("75001", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "network" });
  });

  it("AbortError (timeout) → timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    const res = await geocodePostalCode("75001", { fetchImpl });
    expect(res).toEqual({ ok: false, code: "timeout" });
  });
});

describe("geocodePostalCode — timeout réel via AbortController", () => {
  it("annule la requête après timeoutMs et renvoie timeout", async () => {
    // fetchImpl qui ne résout jamais sauf si signal.abort() est déclenché.
    // On vérifie que le helper coupe bien la requête au-delà du timeout.
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
          // Pas de resolve volontaire — laisse le timeout déclencher.
        }),
    ) as unknown as typeof fetch;

    const res = await geocodePostalCode("75001", {
      fetchImpl,
      timeoutMs: 30,
    });
    expect(res).toEqual({ ok: false, code: "timeout" });
  });
});

describe("GEOCODE_POSTAL_ERROR_MESSAGES — couverture des 4 codes", () => {
  it("expose un message FR pour chacun des 4 codes d'erreur", () => {
    expect(GEOCODE_POSTAL_ERROR_MESSAGES.invalid_format).toMatch(/code postal/i);
    expect(GEOCODE_POSTAL_ERROR_MESSAGES.not_found).toMatch(/introuvable/i);
    expect(GEOCODE_POSTAL_ERROR_MESSAGES.network).toMatch(/(indisponible|réessaie)/i);
    expect(GEOCODE_POSTAL_ERROR_MESSAGES.timeout).toMatch(/(temps|réessaie)/i);
  });
});

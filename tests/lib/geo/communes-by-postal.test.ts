import { describe, it, expect, vi } from "vitest";
import { fetchCommunesByPostalCode } from "@/lib/geo/communes-by-postal";

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("fetchCommunesByPostalCode", () => {
  it("CP invalide → invalid_format, sans appel réseau", async () => {
    const f = mockFetch([]);
    const res = await fetchCommunesByPostalCode("72", { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "invalid_format" });
    expect(f).not.toHaveBeenCalled();
  });

  it("retourne les communes triées + dédupliquées", async () => {
    const f = mockFetch([
      { nom: "Le Mans" },
      { nom: "Allonnes" },
      { nom: "Le Mans" },
    ]);
    const res = await fetchCommunesByPostalCode("72000", { fetchImpl: f });
    expect(res).toEqual({ ok: true, communes: ["Allonnes", "Le Mans"] });
  });

  it("aucune commune → not_found", async () => {
    const f = mockFetch([]);
    const res = await fetchCommunesByPostalCode("99999", { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });

  it("réponse HTTP non-ok → network", async () => {
    const f = mockFetch(null, false);
    const res = await fetchCommunesByPostalCode("72000", { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "network" });
  });

  it("payload non-array → network", async () => {
    const f = mockFetch({ erreur: "x" });
    const res = await fetchCommunesByPostalCode("72000", { fetchImpl: f });
    expect(res.ok).toBe(false);
  });
});

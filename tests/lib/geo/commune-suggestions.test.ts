import { describe, it, expect, vi } from "vitest";
import { fetchCommuneSuggestions } from "@/lib/geo/commune-suggestions";

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe("fetchCommuneSuggestions", () => {
  it("query < 2 caractères → invalid_query, sans appel réseau", async () => {
    const f = mockFetch({ features: [] });
    const res = await fetchCommuneSuggestions("7", { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "invalid_query" });
    expect(f).not.toHaveBeenCalled();
  });

  it("mappe postcode + commune et déduplique", async () => {
    const f = mockFetch({
      features: [
        { properties: { postcode: "72000", name: "Le Mans", city: "Le Mans" } },
        { properties: { postcode: "72100", name: "Le Mans", city: "Le Mans" } },
        { properties: { postcode: "72000", name: "Le Mans", city: "Le Mans" } },
      ],
    });
    const res = await fetchCommuneSuggestions("72", { fetchImpl: f });
    expect(res).toEqual({
      ok: true,
      suggestions: [
        { code_postal: "72000", commune: "Le Mans" },
        { code_postal: "72100", commune: "Le Mans" },
      ],
    });
  });

  it("repli sur name si city absent, ignore les postcodes invalides", async () => {
    const f = mockFetch({
      features: [
        { properties: { postcode: "abc", name: "Invalide" } },
        { properties: { name: "Sans CP" } },
        { properties: { postcode: "49000", name: "Angers" } },
      ],
    });
    const res = await fetchCommuneSuggestions("49", { fetchImpl: f });
    expect(res).toEqual({
      ok: true,
      suggestions: [{ code_postal: "49000", commune: "Angers" }],
    });
  });

  it("réponse HTTP non-ok → network", async () => {
    const f = mockFetch(null, false);
    const res = await fetchCommuneSuggestions("72", { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "network" });
  });

  it("payload sans tableau features → network", async () => {
    const f = mockFetch({ erreur: "x" });
    const res = await fetchCommuneSuggestions("72", { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "network" });
  });
});

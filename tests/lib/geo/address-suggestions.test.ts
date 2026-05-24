import { describe, it, expect, vi } from "vitest";
import { fetchAddressSuggestions } from "@/lib/geo/address-suggestions";

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

const CP = "72000";

describe("fetchAddressSuggestions", () => {
  it("query < 3 caractères → invalid_query, sans appel réseau", async () => {
    const f = mockFetch({ features: [] });
    const res = await fetchAddressSuggestions("ru", CP, { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "invalid_query" });
    expect(f).not.toHaveBeenCalled();
  });

  it("code postal invalide → invalid_query, sans appel réseau", async () => {
    const f = mockFetch({ features: [] });
    const res = await fetchAddressSuggestions("1 rue de la", "72", { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "invalid_query" });
    expect(f).not.toHaveBeenCalled();
  });

  it("mappe label + name et déduplique par label", async () => {
    const f = mockFetch({
      features: [
        { properties: { label: "1 Rue de la Mariette 72000 Le Mans", name: "1 Rue de la Mariette" } },
        { properties: { label: "1 Rue de la Madeleine 72000 Le Mans", name: "1 Rue de la Madeleine" } },
        { properties: { label: "1 Rue de la Mariette 72000 Le Mans", name: "1 Rue de la Mariette" } },
      ],
    });
    const res = await fetchAddressSuggestions("1 rue de la", CP, { fetchImpl: f });
    expect(res).toEqual({
      ok: true,
      suggestions: [
        { label: "1 Rue de la Mariette 72000 Le Mans", name: "1 Rue de la Mariette" },
        { label: "1 Rue de la Madeleine 72000 Le Mans", name: "1 Rue de la Madeleine" },
      ],
    });
  });

  it("réponse HTTP non-ok → network", async () => {
    const f = mockFetch(null, false);
    const res = await fetchAddressSuggestions("1 rue de la", CP, { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "network" });
  });

  it("payload sans tableau features → network", async () => {
    const f = mockFetch({ erreur: "x" });
    const res = await fetchAddressSuggestions("1 rue de la", CP, { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "network" });
  });
});

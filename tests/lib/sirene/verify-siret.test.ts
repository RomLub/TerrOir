import { describe, it, expect, vi } from "vitest";
import { verifySiret } from "@/lib/sirene/verify-siret";

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

const SIRET = "12345678901234";

describe("verifySiret", () => {
  it("format invalide → invalid_format, sans appel réseau", async () => {
    const f = mockFetch({ results: [] });
    const res = await verifySiret("123", { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "invalid_format" });
    expect(f).not.toHaveBeenCalled();
  });

  it("SIRET trouvé (siège) → found + nom légal", async () => {
    const f = mockFetch({
      results: [{ nom_complet: "FERME DES TILLEULS", siege: { siret: SIRET } }],
    });
    const res = await verifySiret(SIRET, { fetchImpl: f });
    expect(res).toEqual({ ok: true, found: true, legalName: "FERME DES TILLEULS" });
  });

  it("SIRET trouvé (établissement matché) → found", async () => {
    const f = mockFetch({
      results: [
        {
          nom_raison_sociale: "GAEC DU PRE",
          siege: { siret: "99999999999999" },
          matching_etablissements: [{ siret: SIRET }],
        },
      ],
    });
    const res = await verifySiret(SIRET, { fetchImpl: f });
    expect(res).toEqual({ ok: true, found: true, legalName: "GAEC DU PRE" });
  });

  it("aucun établissement ne matche le SIRET → found:false", async () => {
    const f = mockFetch({
      results: [{ nom_complet: "AUTRE", siege: { siret: "99999999999999" } }],
    });
    const res = await verifySiret(SIRET, { fetchImpl: f });
    expect(res).toEqual({ ok: true, found: false });
  });

  it("results vide → found:false", async () => {
    const f = mockFetch({ results: [] });
    const res = await verifySiret(SIRET, { fetchImpl: f });
    expect(res).toEqual({ ok: true, found: false });
  });

  it("réponse HTTP non-ok → network", async () => {
    const f = mockFetch(null, false);
    const res = await verifySiret(SIRET, { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "network" });
  });

  it("payload sans tableau results → network", async () => {
    const f = mockFetch({ erreur: "x" });
    const res = await verifySiret(SIRET, { fetchImpl: f });
    expect(res).toEqual({ ok: false, code: "network" });
  });

  it("espaces tolérés dans le SIRET saisi", async () => {
    const f = mockFetch({
      results: [{ nom_complet: "FERME X", siege: { siret: SIRET } }],
    });
    const res = await verifySiret("123 456 789 01234", { fetchImpl: f });
    expect(res).toEqual({ ok: true, found: true, legalName: "FERME X" });
  });

  it("déduit la forme juridique du code nature_juridique (5710 → sas)", async () => {
    const f = mockFetch({
      results: [{ nom_complet: "ARC LUDIS", nature_juridique: "5710", siege: { siret: SIRET } }],
    });
    const res = await verifySiret(SIRET, { fetchImpl: f });
    expect(res).toEqual({
      ok: true,
      found: true,
      legalName: "ARC LUDIS",
      formeJuridique: "sas",
    });
  });

  it("mappe 6533 → gaec, 6598 → earl", async () => {
    const gaec = await verifySiret(SIRET, {
      fetchImpl: mockFetch({
        results: [{ nom_complet: "GAEC DU PRE", nature_juridique: "6533", siege: { siret: SIRET } }],
      }),
    });
    expect(gaec).toMatchObject({ found: true, formeJuridique: "gaec" });

    const earl = await verifySiret(SIRET, {
      fetchImpl: mockFetch({
        results: [{ nom_complet: "EARL X", nature_juridique: "6598", siege: { siret: SIRET } }],
      }),
    });
    expect(earl).toMatchObject({ found: true, formeJuridique: "earl" });
  });

  it("code nature_juridique inconnu → pas de présélection (formeJuridique undefined)", async () => {
    const f = mockFetch({
      results: [{ nom_complet: "ASSO X", nature_juridique: "9220", siege: { siret: SIRET } }],
    });
    const res = await verifySiret(SIRET, { fetchImpl: f });
    expect(res).toEqual({ ok: true, found: true, legalName: "ASSO X" });
    expect((res as { formeJuridique?: string }).formeJuridique).toBeUndefined();
  });
});

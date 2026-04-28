import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchActiveGmsPrices,
  fetchActiveGmsPricesByFiliere,
  type GmsPrice,
  type GmsPriceFiliere,
} from "@/lib/gms-prices/fetch-active";

// Mock Supabase client minimal : supporte la chaîne
//   from('gms_prices').select(cols).eq(c, v).[eq(c, v)].order(c, { ascending })
// .order() est terminal (Promise<{ data, error }>) — awaité directement par
// le helper. Chaque méthode est capturée pour permettre aux tests d'asserter
// les filtres de défense en profondeur (active=true, filiere=X) et le tri.
type Captured = {
  from: string[];
  select: string[];
  eq: Array<[string, unknown]>;
  order: Array<[string, { ascending?: boolean }]>;
};

function makeSupabase(response: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    from: [],
    select: [],
    eq: [],
    order: [],
  };

  const builder: any = {};
  builder.select = (cols: string) => {
    captured.select.push(cols);
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    captured.eq.push([col, val]);
    return builder;
  };
  builder.order = (col: string, opts: { ascending?: boolean }) => {
    captured.order.push([col, opts]);
    return Promise.resolve(response);
  };

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makePrice(overrides: Partial<GmsPrice> = {}): GmsPrice {
  return {
    id: "price-1",
    slug: "boeuf-entrecote",
    filiere: "bovin",
    libelle: "Entrecôte",
    description_courte: null,
    prix_gms_kg: 28.5,
    prix_terroir_kg_min: 36,
    prix_terroir_kg_max: 48,
    prix_terroir_kg_moyen: 42,
    mois_reference: "2026-04",
    source: "test",
    source_url: null,
    ordre_affichage: 2,
    active: true,
    ...overrides,
  };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("fetchActiveGmsPrices — cas nominal", () => {
  it("retourne le tableau de références fourni par Supabase", async () => {
    const prices = [
      makePrice({ slug: "p1", ordre_affichage: 1 }),
      makePrice({ slug: "p2", ordre_affichage: 2 }),
    ];
    const { client } = makeSupabase({ data: prices, error: null });

    const res = await fetchActiveGmsPrices(client);

    expect(res).toEqual(prices);
  });

  it("requête 'gms_prices' avec eq('active', true) + order ordre_affichage ASC", async () => {
    const { client, captured } = makeSupabase({ data: [], error: null });

    await fetchActiveGmsPrices(client);

    expect(captured.from).toEqual(["gms_prices"]);
    expect(captured.eq).toContainEqual(["active", true]);
    expect(captured.order).toEqual([["ordre_affichage", { ascending: true }]]);
  });

  it("retourne [] si data est null (cas Supabase défensif)", async () => {
    const { client } = makeSupabase({ data: null, error: null });

    const res = await fetchActiveGmsPrices(client);

    expect(res).toEqual([]);
  });
});

describe("fetchActiveGmsPrices — cas erreur DB", () => {
  it("log avec préfixe FETCH_GMS_PRICES_ERROR et retourne [] (pas de throw)", async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: "network unreachable" },
    });

    const res = await fetchActiveGmsPrices(client);

    expect(res).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("FETCH_GMS_PRICES_ERROR");
    expect(logged).toContain("network unreachable");
  });
});

describe("fetchActiveGmsPricesByFiliere — défense en profondeur", () => {
  it.each<GmsPriceFiliere>(["bovin", "porcin", "ovin"])(
    "applique eq('active', true) + eq('filiere', '%s') + order ordre_affichage ASC",
    async (filiere) => {
      const { client, captured } = makeSupabase({ data: [], error: null });

      await fetchActiveGmsPricesByFiliere(client, filiere);

      expect(captured.eq).toContainEqual(["active", true]);
      expect(captured.eq).toContainEqual(["filiere", filiere]);
      expect(captured.order).toEqual([["ordre_affichage", { ascending: true }]]);
    },
  );

  it("retourne le tableau filtré tel que fourni par Supabase", async () => {
    const bovinPrices = [
      makePrice({ slug: "boeuf-1", filiere: "bovin", ordre_affichage: 1 }),
    ];
    const { client } = makeSupabase({ data: bovinPrices, error: null });

    const res = await fetchActiveGmsPricesByFiliere(client, "bovin");

    expect(res).toEqual(bovinPrices);
  });

  it("log avec préfixe + filiere et retourne [] sur erreur DB", async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: "timeout" },
    });

    const res = await fetchActiveGmsPricesByFiliere(client, "porcin");

    expect(res).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("FETCH_GMS_PRICES_ERROR");
    expect(logged).toContain("filiere=porcin");
    expect(logged).toContain("timeout");
  });
});

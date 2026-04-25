import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { promoteProducerToPublicIfActive } from "@/lib/producers/promote-to-public";
import { revalidatePublicStats } from "@/lib/stats/revalidate";

// Mock isolation : on vérifie que le helper appelle la server action
// d'invalidation cache UNIQUEMENT quand une vraie promotion a eu lieu.
vi.mock("@/lib/stats/revalidate", () => ({
  revalidatePublicStats: vi.fn(),
}));

// Mock Supabase client minimal : supporte la chaîne
//   from('producers').update({ statut: 'public' }).eq('id', v).eq('statut', 'active').select('id')
// Le `.select()` termine la chaîne (PostgREST renvoie les rows modifiées).
// Chaque méthode est capturée pour asserter :
//   - le payload d'update ({ statut: 'public' })
//   - la garde d'idempotence (.eq('statut', 'active'))
//   - la cible précise (.eq('id', producerId))
//   - le `.select('id')` requis pour détecter une vraie promotion
type Captured = {
  from: string[];
  update: unknown[];
  eq: Array<[string, unknown]>;
  select: string[];
};

function makeSupabase(response: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    from: [],
    update: [],
    eq: [],
    select: [],
  };

  const builder: any = {};
  builder.update = (payload: unknown) => {
    captured.update.push(payload);
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    captured.eq.push([col, val]);
    return builder;
  };
  // .select() termine la chaîne : on rend le builder thenable à ce stade.
  builder.select = (cols: string) => {
    captured.select.push(cols);
    return builder;
  };
  builder.then = (
    onFulfilled: (r: { data: unknown; error: unknown }) => unknown,
  ) => onFulfilled(response);

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(revalidatePublicStats).mockClear();
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
});

describe("promoteProducerToPublicIfActive — cas nominal", () => {
  it("émet UPDATE producers SET statut='public' WHERE id=? AND statut='active' avec .select('id')", async () => {
    const { client, captured } = makeSupabase({
      data: [{ id: "producer-42" }],
      error: null,
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers"]);
    expect(captured.update).toEqual([{ statut: "public" }]);
    expect(captured.eq).toEqual([
      ["id", "producer-42"],
      ["statut", "active"],
    ]);
    expect(captured.select).toEqual(["id"]);
  });

  it("retourne void (Promise<void>) en cas de succès", async () => {
    const { client } = makeSupabase({
      data: [{ id: "producer-42" }],
      error: null,
    });

    const res = await promoteProducerToPublicIfActive(client, "producer-42");

    expect(res).toBeUndefined();
  });

  it("ne log PAS console.warn quand l'update réussit", async () => {
    const { client } = makeSupabase({
      data: [{ id: "producer-42" }],
      error: null,
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("promoteProducerToPublicIfActive — idempotence (garde statut='active')", () => {
  it("applique .eq('statut', 'active') en 2e filtre — no-op si déjà public/draft/pending/suspended", async () => {
    // L'idempotence repose entièrement sur cette garde : si le producer n'est
    // pas 'active', l'UPDATE ne matche aucune ligne, donc pas de transition.
    // Sans cette clause, un producer 'suspended' pourrait être re-publié.
    const { client, captured } = makeSupabase({ data: [], error: null });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.eq).toContainEqual(["statut", "active"]);
  });
});

describe("promoteProducerToPublicIfActive — invalidation cache public-stats", () => {
  it("appelle revalidatePublicStats quand une promotion réelle a eu lieu (data.length > 0)", async () => {
    const { client } = makeSupabase({
      data: [{ id: "producer-42" }],
      error: null,
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledTimes(1);
  });

  it("n'appelle PAS revalidatePublicStats quand l'UPDATE est no-op (data.length = 0)", async () => {
    // Cas typique : producer déjà 'public', la garde .eq('statut', 'active')
    // ne matche aucune ligne, .select('id') renvoie []. Pas de changement
    // observable côté DB → invalider le cache serait inutile.
    const { client } = makeSupabase({ data: [], error: null });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });

  it("n'appelle PAS revalidatePublicStats quand l'UPDATE retourne une erreur", async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: "RLS policy violation" },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });
});

describe("promoteProducerToPublicIfActive — fail-open (cas erreur DB)", () => {
  it("ne throw PAS quand Supabase remonte une erreur", async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: "RLS policy violation" },
    });

    // L'erreur doit être silencieuse pour ne pas casser la création de produit.
    await expect(
      promoteProducerToPublicIfActive(client, "producer-42"),
    ).resolves.toBeUndefined();
  });

  it("log PROMOTE_PRODUCER_WARN via console.warn quand l'update échoue", async () => {
    const err = { message: "RLS policy violation" };
    const { client } = makeSupabase({ data: null, error: err });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const args = consoleWarnSpy.mock.calls[0] ?? [];
    // Convention grep du repo : le préfixe PROMOTE_PRODUCER_WARN doit être
    // présent pour pouvoir filtrer les logs Vercel.
    expect(String(args[0])).toContain("PROMOTE_PRODUCER_WARN");
    expect(String(args[0])).toContain("promoteProducerToPublicIfActive");
    expect(args[1]).toBe(err);
  });

  it("n'utilise PAS console.error (fail-open volontaire, pas une erreur alerte)", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { client } = makeSupabase({
      data: null,
      error: { message: "network unreachable" },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

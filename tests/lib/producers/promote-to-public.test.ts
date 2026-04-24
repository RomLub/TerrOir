import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { promoteProducerToPublicIfActive } from "@/lib/producers/promote-to-public";

// Mock Supabase client minimal : supporte la chaîne
//   from('producers').update({ statut: 'public' }).eq('id', v).eq('statut', 'active')
// La dernière .eq() renvoie une Promise (update terminal dans PostgREST).
// Chaque méthode est capturée pour asserter :
//   - le payload d'update ({ statut: 'public' })
//   - la garde d'idempotence (.eq('statut', 'active'))
//   - la cible précise (.eq('id', producerId))
type Captured = {
  from: string[];
  update: unknown[];
  eq: Array<[string, unknown]>;
};

function makeSupabase(response: { error: unknown }): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    from: [],
    update: [],
    eq: [],
  };

  const builder: any = {};
  builder.update = (payload: unknown) => {
    captured.update.push(payload);
    return builder;
  };
  // La 2e .eq() termine la chaîne côté Supabase (update sans .select()).
  // On la rend thenable pour matcher le `await` du helper.
  builder.eq = (col: string, val: unknown) => {
    captured.eq.push([col, val]);
    return builder;
  };
  builder.then = (onFulfilled: (r: { error: unknown }) => unknown) =>
    onFulfilled(response);

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
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
});

describe("promoteProducerToPublicIfActive — cas nominal", () => {
  it("émet UPDATE producers SET statut='public' WHERE id=? AND statut='active'", async () => {
    const { client, captured } = makeSupabase({ error: null });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers"]);
    expect(captured.update).toEqual([{ statut: "public" }]);
    expect(captured.eq).toEqual([
      ["id", "producer-42"],
      ["statut", "active"],
    ]);
  });

  it("retourne void (Promise<void>) en cas de succès", async () => {
    const { client } = makeSupabase({ error: null });

    const res = await promoteProducerToPublicIfActive(client, "producer-42");

    expect(res).toBeUndefined();
  });

  it("ne log PAS console.warn quand l'update réussit", async () => {
    const { client } = makeSupabase({ error: null });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("promoteProducerToPublicIfActive — idempotence (garde statut='active')", () => {
  it("applique .eq('statut', 'active') en 2e filtre — no-op si déjà public/draft/pending/suspended", async () => {
    // L'idempotence repose entièrement sur cette garde : si le producer n'est
    // pas 'active', l'UPDATE ne matche aucune ligne, donc pas de transition.
    // Sans cette clause, un producer 'suspended' pourrait être re-publié.
    const { client, captured } = makeSupabase({ error: null });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.eq).toContainEqual(["statut", "active"]);
  });
});

describe("promoteProducerToPublicIfActive — fail-open (cas erreur DB)", () => {
  it("ne throw PAS quand Supabase remonte une erreur", async () => {
    const { client } = makeSupabase({
      error: { message: "RLS policy violation" },
    });

    // L'erreur doit être silencieuse pour ne pas casser la création de produit.
    await expect(
      promoteProducerToPublicIfActive(client, "producer-42"),
    ).resolves.toBeUndefined();
  });

  it("log PROMOTE_PRODUCER_WARN via console.warn quand l'update échoue", async () => {
    const err = { message: "RLS policy violation" };
    const { client } = makeSupabase({ error: err });

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
      error: { message: "network unreachable" },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

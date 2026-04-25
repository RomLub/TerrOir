import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { promoteProducerToPublicIfActive } from "@/lib/producers/promote-to-public";
import { revalidatePublicStats } from "@/lib/stats/revalidate";

// Mock isolation : on vérifie que le helper appelle la server action
// d'invalidation cache UNIQUEMENT quand une vraie promotion a eu lieu.
vi.mock("@/lib/stats/revalidate", () => ({
  revalidatePublicStats: vi.fn(),
}));

// Réponses Supabase modélisées par chaîne logique. Le helper effectue
// jusqu'à 4 appels successifs :
//   1. from('producers').select('statut, stripe_charges_enabled')
//        .eq('id', X).maybeSingle()       → producersPreCheck
//   2. from('products').select('id', { count: 'exact', head: true })
//        .eq('producer_id', X).eq('active', true)   → productsCount (thenable)
//   3. from('slots').select('id', { count: 'exact', head: true })
//        .eq('producer_id', X).eq('active', true)
//        .is('excluded_at', null)         → slotsCount (thenable)
//   4. from('producers').update({ statut: 'public' })
//        .eq('id', X).eq('statut', 'active').select('id') → producersUpdate
//
// Tout appel non explicitement renseigné renvoie un default OK (fixture
// nominal). Les tests "fail-open" overrident une seule étape pour isoler.
type Resp = { data?: unknown; error?: unknown; count?: number | null };

type Captured = {
  // Suite des tables visitées via from(...). Ordre attendu nominal :
  // ['producers', 'products', 'slots', 'producers'].
  from: string[];
  // Payloads d'update (uniquement le 4e appel : { statut: 'public' }).
  update: unknown[];
  // Filtres .eq accumulés tous chaînes confondues. Permet d'asserter par
  // exemple la présence de ['statut', 'active'] sur la garde finale.
  eq: Array<[string, unknown]>;
  // Filtres .is accumulés (utilisé par le pré-check slots).
  is: Array<[string, unknown]>;
  // Args .select accumulés tous chaînes confondues. Pour les counts, on
  // capte l'objet { cols, opts } afin de vérifier `count: 'exact', head: true`.
  select: Array<string | { cols: string; opts: unknown }>;
  // Nombre d'appels .maybeSingle() (1 attendu : pré-check producers).
  maybeSingle: number;
};

const OK_RESPONSES = {
  producersPreCheck: {
    data: { statut: "active", stripe_charges_enabled: true },
    error: null,
  } as Resp,
  productsCount: { count: 3, error: null } as Resp,
  slotsCount: { count: 12, error: null } as Resp,
  producersUpdate: { data: [{ id: "producer-42" }], error: null } as Resp,
};

function makeSupabase(overrides: Partial<typeof OK_RESPONSES> = {}): {
  client: SupabaseClient;
  captured: Captured;
} {
  const responses = { ...OK_RESPONSES, ...overrides };
  const captured: Captured = {
    from: [],
    update: [],
    eq: [],
    is: [],
    select: [],
    maybeSingle: 0,
  };

  function makeBuilder(getResponse: () => Resp) {
    const builder: any = {};
    builder.update = (payload: unknown) => {
      captured.update.push(payload);
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      captured.eq.push([col, val]);
      return builder;
    };
    builder.is = (col: string, val: unknown) => {
      captured.is.push([col, val]);
      return builder;
    };
    builder.select = (cols: string, opts?: unknown) => {
      captured.select.push(opts === undefined ? cols : { cols, opts });
      return builder;
    };
    builder.maybeSingle = () => {
      captured.maybeSingle += 1;
      return Promise.resolve(getResponse());
    };
    // Thenable : permet `await chain.eq(...).is(...)` pour les counts +
    // `await chain.update(...).eq(...).select(...)` pour l'UPDATE final.
    builder.then = (
      onFulfilled: (r: Resp) => unknown,
    ) => onFulfilled(getResponse());
    return builder;
  }

  let producersFromCount = 0;
  const client = {
    from: (table: string) => {
      captured.from.push(table);
      if (table === "producers") {
        producersFromCount += 1;
        // 1er appel = pré-check (.select + .maybeSingle), 2e = UPDATE.
        const useUpdate = producersFromCount >= 2;
        return makeBuilder(() =>
          useUpdate ? responses.producersUpdate : responses.producersPreCheck,
        );
      }
      if (table === "products") return makeBuilder(() => responses.productsCount);
      if (table === "slots") return makeBuilder(() => responses.slotsCount);
      throw new Error(`Mock supabase: unexpected table ${table}`);
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

describe("promoteProducerToPublicIfActive — cas nominal (3 conditions OK)", () => {
  it("émet les 4 chaînes attendues : pré-check producers, count products, count slots, UPDATE", async () => {
    const { client, captured } = makeSupabase();

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers", "products", "slots", "producers"]);
    expect(captured.update).toEqual([{ statut: "public" }]);
    expect(captured.maybeSingle).toBe(1);
    // La garde idempotente .eq('statut', 'active') doit toujours être posée
    // sur la 4e chaîne (UPDATE).
    expect(captured.eq).toContainEqual(["statut", "active"]);
    // Le pré-check slots filtre les slots non-exclus.
    expect(captured.is).toContainEqual(["excluded_at", null]);
  });

  it("invoque revalidatePublicStats quand une promotion réelle a eu lieu", async () => {
    const { client } = makeSupabase();

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(vi.mocked(revalidatePublicStats)).toHaveBeenCalledTimes(1);
  });

  it("ne log PAS console.warn quand toutes les chaînes réussissent", async () => {
    const { client } = makeSupabase();

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("count products utilise { count: 'exact', head: true } (pas de payload row)", async () => {
    const { client, captured } = makeSupabase();

    await promoteProducerToPublicIfActive(client, "producer-42");

    // 2e .select de la séquence = pré-check products.
    const productsSelect = captured.select[1];
    expect(productsSelect).toEqual({
      cols: "id",
      opts: { count: "exact", head: true },
    });
  });
});

describe("promoteProducerToPublicIfActive — pré-check producers", () => {
  it("no-op si producer introuvable (data=null) — sans warn ni promotion", async () => {
    const { client, captured } = makeSupabase({
      producersPreCheck: { data: null, error: null },
    });

    await promoteProducerToPublicIfActive(client, "ghost");

    expect(captured.from).toEqual(["producers"]); // pas d'autres chaînes
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });

  it("no-op si producer.statut === 'pending' (pas encore activé)", async () => {
    const { client, captured } = makeSupabase({
      producersPreCheck: {
        data: { statut: "pending", stripe_charges_enabled: true },
        error: null,
      },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers"]);
    expect(captured.update).toEqual([]);
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });

  it("no-op si producer déjà 'public' (idempotence côté pré-check)", async () => {
    const { client, captured } = makeSupabase({
      producersPreCheck: {
        data: { statut: "public", stripe_charges_enabled: true },
        error: null,
      },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers"]);
    expect(captured.update).toEqual([]);
  });

  it("no-op si stripe_charges_enabled === false (compte Stripe pas prêt)", async () => {
    const { client, captured } = makeSupabase({
      producersPreCheck: {
        data: { statut: "active", stripe_charges_enabled: false },
        error: null,
      },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers"]);
    expect(captured.update).toEqual([]);
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });

  it("fail-open + warn si l'erreur DB remonte sur le pré-check producers", async () => {
    const { client, captured } = makeSupabase({
      producersPreCheck: {
        data: null,
        error: { message: "RLS policy violation" },
      },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers"]);
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "PROMOTE_PRODUCER_WARN",
    );
  });
});

describe("promoteProducerToPublicIfActive — pré-check products", () => {
  it("no-op si aucun produit actif (count=0)", async () => {
    const { client, captured } = makeSupabase({
      productsCount: { count: 0, error: null },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    // Pas d'appel slots ni d'UPDATE après l'échec du pré-check products.
    expect(captured.from).toEqual(["producers", "products"]);
    expect(captured.update).toEqual([]);
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });

  it("no-op si count remonte null (filtré comme 0)", async () => {
    const { client, captured } = makeSupabase({
      productsCount: { count: null, error: null },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers", "products"]);
    expect(captured.update).toEqual([]);
  });

  it("filtre products par producer_id ET active=true", async () => {
    const { client, captured } = makeSupabase();

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.eq).toContainEqual(["producer_id", "producer-42"]);
    expect(captured.eq).toContainEqual(["active", true]);
  });

  it("fail-open + warn si l'erreur DB remonte sur le count products", async () => {
    const { client, captured } = makeSupabase({
      productsCount: { count: null, error: { message: "timeout" } },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers", "products"]);
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("promoteProducerToPublicIfActive — pré-check slots", () => {
  it("no-op si aucun créneau actif disponible (count=0)", async () => {
    const { client, captured } = makeSupabase({
      slotsCount: { count: 0, error: null },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers", "products", "slots"]);
    expect(captured.update).toEqual([]);
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });

  it("filtre slots par producer_id, active=true ET excluded_at IS NULL", async () => {
    // Symétrique au filter consumer (RPC create_order_with_items) : un slot
    // exclu manuellement n'est pas réservable, donc ne compte pas pour
    // valider la condition "peut livrer".
    const { client, captured } = makeSupabase();

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.eq).toContainEqual(["producer_id", "producer-42"]);
    expect(captured.eq).toContainEqual(["active", true]);
    expect(captured.is).toEqual([["excluded_at", null]]);
  });

  it("fail-open + warn si l'erreur DB remonte sur le count slots", async () => {
    const { client, captured } = makeSupabase({
      slotsCount: { count: null, error: { message: "RLS denied" } },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.from).toEqual(["producers", "products", "slots"]);
    expect(captured.update).toEqual([]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("promoteProducerToPublicIfActive — UPDATE final + idempotence", () => {
  it("émet UPDATE producers SET statut='public' WHERE id=? AND statut='active' avec .select('id')", async () => {
    const { client, captured } = makeSupabase();

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(captured.update).toEqual([{ statut: "public" }]);
    // Filtre final = ['id', 'producer-42'] + ['statut', 'active'].
    // (Les autres .eq des pré-checks sont également dans le tableau.)
    expect(captured.eq).toContainEqual(["id", "producer-42"]);
    expect(captured.eq).toContainEqual(["statut", "active"]);
    expect(captured.select).toContain("id");
  });

  it("retourne void (Promise<void>) en cas de succès", async () => {
    const { client } = makeSupabase();

    const res = await promoteProducerToPublicIfActive(client, "producer-42");

    expect(res).toBeUndefined();
  });

  it("n'invalide PAS le cache si l'UPDATE no-op (data.length=0, ex: race condition)", async () => {
    // Cas race : entre le pré-check et l'UPDATE, un autre process a déjà
    // promu le producer. La garde .eq('statut', 'active') matche 0 rows,
    // donc pas de transition observable → pas de revalidation utile.
    const { client } = makeSupabase({
      producersUpdate: { data: [], error: null },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });

  it("fail-open + warn si l'UPDATE final retourne une erreur DB", async () => {
    const { client } = makeSupabase({
      producersUpdate: { data: null, error: { message: "RLS policy violation" } },
    });

    await expect(
      promoteProducerToPublicIfActive(client, "producer-42"),
    ).resolves.toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const args = consoleWarnSpy.mock.calls[0] ?? [];
    expect(String(args[0])).toContain("PROMOTE_PRODUCER_WARN");
    expect(String(args[0])).toContain("promoteProducerToPublicIfActive");
    expect(vi.mocked(revalidatePublicStats)).not.toHaveBeenCalled();
  });

  it("n'utilise PAS console.error (fail-open volontaire à toutes les étapes)", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { client } = makeSupabase({
      producersUpdate: { data: null, error: { message: "network unreachable" } },
    });

    await promoteProducerToPublicIfActive(client, "producer-42");

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

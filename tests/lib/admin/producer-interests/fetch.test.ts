// Tests vitest pour lib/admin/producer-interests/fetch.ts.
//
// Stratégie : mock SupabaseClient injecté via argument (pattern aligné
// tests/lib/producer-interests/upsert-interest.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchProducerInterestsList,
  getProducerInterest,
} from "@/lib/admin/producer-interests/fetch";

type Resp = { data?: unknown; error?: unknown };

let response: Resp;
let captured: {
  fromCalls: string[];
  selects: string[];
  orders: Array<{ col: string; ascending: boolean }>;
  eqCalls: Array<{ col: string; val: unknown }>;
  // resolverKind discrimine select() awaitable vs maybeSingle() awaitable.
  resolverKind: "list" | "single" | null;
};

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & {
        then: (resolve: (v: Resp) => void) => unknown;
      } = {
        then: (resolve: (v: Resp) => void) => {
          resolve(response);
          return undefined;
        },
      };
      builder.select = (cols: string) => {
        captured.selects.push(cols);
        return builder;
      };
      builder.order = (col: string, opts: { ascending: boolean }) => {
        captured.orders.push({ col, ascending: opts.ascending });
        captured.resolverKind = "list";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ col, val });
        return builder;
      };
      builder.maybeSingle = () => {
        captured.resolverKind = "single";
        return Promise.resolve(response);
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    orders: [],
    eqCalls: [],
    resolverKind: null,
  };
  response = { data: null, error: null };
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("fetchProducerInterestsList", () => {
  it("retourne la liste triée par created_at desc", async () => {
    response = {
      data: [
        {
          id: "1",
          created_at: "2026-05-10T00:00:00Z",
          prenom: "Jean",
          nom: "Dupont",
          email: "j@example.com",
          telephone: null,
          nom_exploitation: null,
          commune: null,
          especes: null,
          message: null,
          statut: "new",
          source: "formulaire_public",
        },
      ],
      error: null,
    };
    const rows = await fetchProducerInterestsList(buildMockClient());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("1");
    expect(captured.fromCalls).toEqual(["producer_interests"]);
    expect(captured.orders[0]).toEqual({
      col: "created_at",
      ascending: false,
    });
  });

  it("retourne tableau vide si data null", async () => {
    response = { data: null, error: null };
    const rows = await fetchProducerInterestsList(buildMockClient());
    expect(rows).toEqual([]);
  });

  it("throw si erreur Supabase", async () => {
    response = { data: null, error: { message: "boom" } };
    await expect(
      fetchProducerInterestsList(buildMockClient()),
    ).rejects.toThrow("boom");
  });
});

describe("getProducerInterest", () => {
  it("retourne la row si trouvée", async () => {
    response = {
      data: {
        id: "abc",
        created_at: "2026-05-10T00:00:00Z",
        prenom: null,
        nom: "X",
        email: "x@example.com",
        telephone: null,
        nom_exploitation: null,
        commune: null,
        especes: null,
        message: null,
        statut: "contacted",
        source: "invitation_directe",
      },
      error: null,
    };
    const row = await getProducerInterest(buildMockClient(), "abc");
    expect(row?.id).toBe("abc");
    expect(captured.eqCalls[0]).toEqual({ col: "id", val: "abc" });
    expect(captured.resolverKind).toBe("single");
  });

  it("retourne null si data null (id introuvable)", async () => {
    response = { data: null, error: null };
    const row = await getProducerInterest(buildMockClient(), "missing");
    expect(row).toBeNull();
  });

  it("throw si erreur Supabase", async () => {
    response = { data: null, error: { message: "db error" } };
    await expect(
      getProducerInterest(buildMockClient(), "abc"),
    ).rejects.toThrow("db error");
  });
});

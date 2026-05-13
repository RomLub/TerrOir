import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests des helpers fetch admin reviews. Mock du client Supabase admin
// pour exercer la chaîne PostgREST (from/select/eq/order/.../limit).
// Le code testé n'a pas besoin du vrai service_role — on injecte un client
// stub avec exactement les méthodes utilisées.

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
});

vi.mock("@/lib/supabase/admin", () => ({
  // Sera surchargé via injection client dans les helpers (paramètre
  // optionnel client) — laisse un fallback simple ici par sécurité.
  createSupabaseAdminClient: () => ({ from: () => ({}) }),
}));

import {
  fetchPendingReviews,
  fetchPublishedResponses,
} from "@/lib/admin/reviews/fetch-reviews";

// Builder de chaîne supabase fluide qui retourne `result` au bout. Couvre
// le pattern utilisé par les helpers : .from().select().eq().eq().order()
// .limit() (pour responses) ou .from().select().eq().order() (pour pending).
function buildClient<T>(
  result: { data: T[] | null; error: { message: string } | null },
) {
  // Chaque méthode retourne `chain` lui-même pour permettre n'importe
  // quelle profondeur de chaînage. Le `then` permet à `await query` de
  // résoudre à la fin (Supabase utilise des thenables).
  const chain: Record<string, unknown> = {};
  const handler = {
    get(target: typeof chain, prop: string): unknown {
      if (prop === "then") {
        return (resolve: (v: typeof result) => void) => resolve(result);
      }
      return () => proxy;
    },
  };
  const proxy = new Proxy(chain, handler);
  return { from: () => proxy } as unknown as ReturnType<
    typeof import("@/lib/supabase/admin").createSupabaseAdminClient
  >;
}

const PENDING_ROW = {
  id: "r1",
  note: 3,
  commentaire: "ok",
  created_at: "2026-05-13T10:00:00.000Z",
  consumer: { prenom: "Jean", nom: "Dupont" },
  producer: { nom_exploitation: "Ferme du Test", slug: "ferme-du-test" },
};

const RESPONSE_ROW = {
  ...PENDING_ROW,
  producer_response: "Merci",
  producer_response_at: "2026-05-14T11:00:00.000Z",
  producer_response_status: "published",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchPendingReviews", () => {
  it("happy path : map la liste de reviews pending", async () => {
    const client = buildClient({ data: [PENDING_ROW], error: null });
    const res = await fetchPendingReviews(client);
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "r1",
      author: "Jean D.",
      rating: 3,
      producer: "Ferme du Test",
      producerSlug: "ferme-du-test",
    });
  });

  it("data null → rows vide, error null", async () => {
    const client = buildClient({ data: null, error: null });
    const res = await fetchPendingReviews(client);
    expect(res.rows).toEqual([]);
    expect(res.error).toBeNull();
  });

  it("error DB → rows vide + error string", async () => {
    const client = buildClient({
      data: null,
      error: { message: "boom" },
    });
    const res = await fetchPendingReviews(client);
    expect(res.rows).toEqual([]);
    expect(res.error).toBe("boom");
  });
});

describe("fetchPublishedResponses", () => {
  it("happy path : map la liste de réponses publiées", async () => {
    const client = buildClient({ data: [RESPONSE_ROW], error: null });
    const res = await fetchPublishedResponses(client);
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "r1",
      author: "Jean D.",
      response: "Merci",
      responseStatus: "published",
    });
  });

  it("error DB → rows vide + error string", async () => {
    const client = buildClient({
      data: null,
      error: { message: "rls down" },
    });
    const res = await fetchPublishedResponses(client);
    expect(res.rows).toEqual([]);
    expect(res.error).toBe("rls down");
  });
});

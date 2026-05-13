import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests PATCH /api/admin/producers/[id]/statut.
// Pattern aligné sur tests/app/api/admin/categories/[id]/route.test.ts.

type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

// next/cache : revalidatePath / revalidateTag — on stub muet (les server-only
// helpers de lib/stats/revalidate sont reroutés via leur propre module mock
// pour éviter de tirer next/cache en environnement test).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const { mockLog, mockRevalidateStats, mockRevalidateSearch } = vi.hoisted(
  () => ({
    mockLog: vi.fn(),
    mockRevalidateStats: vi.fn(),
    mockRevalidateSearch: vi.fn(),
  }),
);

vi.mock("@/lib/audit-logs/log-producers-admin-event", () => ({
  logProducersAdminEvent: mockLog,
}));

vi.mock("@/lib/stats/revalidate", () => ({
  revalidatePublicStats: mockRevalidateStats,
  revalidateProducersSearch: mockRevalidateSearch,
}));

// Mock Supabase admin client — pattern multi-op (select / update) queue
// par opération. Cohérent invite route test.
type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update", Resp[]>>
>;

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = {
        _op: "pending",
      };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        if (builder._op === "pending") builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.eq = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  }),
}));

// Import APRÈS les mocks.
import { PATCH } from "@/app/api/admin/producers/[id]/statut/route";

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

function pushResp(
  table: string,
  op: "select" | "update",
  ...resps: Resp[]
) {
  responses[table] = responses[table] ?? {};
  responses[table][op] = [...(responses[table][op] ?? []), ...resps];
}

const PRODUCER_ID = "11111111-1111-1111-1111-111111111111";

const BEFORE = {
  id: PRODUCER_ID,
  statut: "pending",
  nom_exploitation: "Ferme du Test",
  slug: "ferme-du-test",
};

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  captured = { fromCalls: [], selects: [], updates: [] };
  responses = {};
  mockLog.mockReset().mockResolvedValue(undefined);
  mockRevalidateStats.mockReset().mockResolvedValue(undefined);
  mockRevalidateSearch.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/admin/producers/[id]/statut", () => {
  it("non admin → 403, pas de SELECT/UPDATE", async () => {
    sessionUser = null;
    const res = await PATCH(makeRequest({ statut: "active" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(403);
    expect(captured.fromCalls).toEqual([]);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("session sans isAdmin (consumer accidentel) → 403", async () => {
    sessionUser = {
      id: "consumer-1",
      email: "x@x.fr",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await PATCH(makeRequest({ statut: "active" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(403);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("body manquant statut → 400", async () => {
    const res = await PATCH(makeRequest({}), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(400);
    expect(captured.fromCalls).toEqual([]);
  });

  it("body statut invalide (hors enum) → 400", async () => {
    const res = await PATCH(makeRequest({ statut: "archived" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(400);
    expect(captured.fromCalls).toEqual([]);
  });

  it("producer inexistant → 404, pas d'audit, pas de revalidate", async () => {
    pushResp("producers", "select", { data: null, error: null });
    const res = await PATCH(makeRequest({ statut: "active" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(404);
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockRevalidateStats).not.toHaveBeenCalled();
    expect(mockRevalidateSearch).not.toHaveBeenCalled();
  });

  it("SELECT db error → 500 générique (pas de leak), pas d'audit", async () => {
    pushResp("producers", "select", {
      data: null,
      error: { message: "boom", code: "57P03" },
    });
    const res = await PATCH(makeRequest({ statut: "active" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal database error");
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("statut identique (no-op) → 200 noop, pas d'UPDATE, pas d'audit", async () => {
    pushResp("producers", "select", { data: BEFORE, error: null });
    const res = await PATCH(makeRequest({ statut: "pending" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.noop).toBe(true);
    expect(captured.updates).toEqual([]);
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockRevalidateStats).not.toHaveBeenCalled();
  });

  it("succès pending → active : UPDATE + audit log + revalidate", async () => {
    pushResp("producers", "select", { data: BEFORE, error: null });
    pushResp("producers", "update", { data: null, error: null });
    const res = await PATCH(makeRequest({ statut: "active" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: PRODUCER_ID, statut: "active" });

    // UPDATE bien envoyé avec le bon payload
    expect(captured.updates).toEqual([
      { table: "producers", payload: { statut: "active" } },
    ]);

    // Audit log capture before/after + snapshot nom/slug
    expect(mockLog).toHaveBeenCalledOnce();
    expect(mockLog.mock.calls[0][0]).toEqual({
      eventType: "admin_producer_statut_changed",
      userId: "admin-1",
      metadata: {
        producer_id: PRODUCER_ID,
        previous_statut: "pending",
        new_statut: "active",
        producer_name: "Ferme du Test",
        producer_slug: "ferme-du-test",
      },
    });

    // Caches publics impactés invalidés
    expect(mockRevalidateStats).toHaveBeenCalledOnce();
    expect(mockRevalidateSearch).toHaveBeenCalledOnce();
  });

  it("succès active → suspended : audit log capture la bonne transition", async () => {
    pushResp("producers", "select", {
      data: { ...BEFORE, statut: "active" },
      error: null,
    });
    pushResp("producers", "update", { data: null, error: null });
    const res = await PATCH(makeRequest({ statut: "suspended" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockLog.mock.calls[0][0].metadata).toMatchObject({
      previous_statut: "active",
      new_statut: "suspended",
    });
  });

  it("UPDATE db error → 500 générique, pas d'audit, pas de revalidate", async () => {
    pushResp("producers", "select", { data: BEFORE, error: null });
    pushResp("producers", "update", {
      data: null,
      error: { message: "constraint violation", code: "23514" },
    });
    const res = await PATCH(makeRequest({ statut: "active" }), {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal database error");
    expect(mockLog).not.toHaveBeenCalled();
    expect(mockRevalidateStats).not.toHaveBeenCalled();
  });

  it("body JSON malformed → 400", async () => {
    const req = {
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Request;
    const res = await PATCH(req, {
      params: Promise.resolve({ id: PRODUCER_ID }),
    });
    expect(res.status).toBe(400);
  });
});

// Tests vitest pour PATCH /api/producer/products/[id].
//
// Stratégie : mock getSessionUser + notifyBackInStock + createSupabaseAdminClient.
// Mock client gère SELECT producers + SELECT products + UPDATE products
// (3 chaînes successives).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
});

const {
  mockGetSessionUser,
  mockNotifyBackInStock,
  mockClientHolder,
} = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
  mockNotifyBackInStock: vi.fn(),
  mockClientHolder: { current: null as SupabaseClient | null },
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mockGetSessionUser,
}));
vi.mock("@/lib/stock-alerts/notify-back-in-stock", () => ({
  notifyBackInStock: mockNotifyBackInStock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockClientHolder.current!,
}));

import { PATCH } from "@/app/api/producer/products/[id]/route";

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return { data: null, error: null };
}

function pushResp(
  table: string,
  op: "select" | "update",
  ...resps: Resp[]
) {
  responses[table] = responses[table] ?? {};
  responses[table][op] = [...(responses[table][op] ?? []), ...resps];
}

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
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
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  } as unknown as SupabaseClient;
}

const SESSION_ID = "user-uuid-1";
const PRODUCER_ID = "producer-uuid-1";
const PRODUCT_ID = "11111111-1111-1111-1111-111111111111";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = { fromCalls: [], selects: [], updates: [], eqCalls: [] };
  responses = {};
  mockGetSessionUser.mockReset();
  mockNotifyBackInStock.mockReset();
  mockClientHolder.current = buildMockClient();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  // Default session : producer connecté
  mockGetSessionUser.mockResolvedValue({
    id: SESSION_ID,
    email: "p@x.com",
    roles: [],
    isAdmin: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost/api/producer/products/${PRODUCT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: { id: PRODUCT_ID } };

function defaultProducerOk() {
  pushResp("producers", "select", {
    data: { id: PRODUCER_ID },
    error: null,
  });
}

function defaultProductIndispoOwnedByProducer() {
  pushResp("products", "select", {
    data: {
      id: PRODUCT_ID,
      producer_id: PRODUCER_ID,
      stock_disponible: 0,
      stock_illimite: false,
    },
    error: null,
  });
}

describe("PATCH /api/producer/products/[id] — auth", () => {
  it("session absente → 401", async () => {
    mockGetSessionUser.mockResolvedValueOnce(null);
    const res = await PATCH(makeRequest({ stock_disponible: 5 }), ctx);
    expect(res.status).toBe(401);
  });

  it("user pas un producer (pas de row producers.user_id=...) → 403", async () => {
    pushResp("producers", "select", { data: null, error: null });
    const res = await PATCH(makeRequest({ stock_disponible: 5 }), ctx);
    expect(res.status).toBe(403);
  });

  it("erreur DB sur lookup producer → 500 + log", async () => {
    pushResp("producers", "select", {
      data: null,
      error: { message: "db down" },
    });
    const res = await PATCH(makeRequest({ stock_disponible: 5 }), ctx);
    expect(res.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("PATCH /api/producer/products/[id] — validation Zod", () => {
  it("body vide → 400 (refine non-empty)", async () => {
    const res = await PATCH(makeRequest({}), ctx);
    expect(res.status).toBe(400);
  });

  it("body invalide (stock_disponible négatif) → 400", async () => {
    const res = await PATCH(makeRequest({ stock_disponible: -1 }), ctx);
    expect(res.status).toBe(400);
  });

  it("body invalide (stock_disponible non entier) → 400", async () => {
    const res = await PATCH(makeRequest({ stock_disponible: 1.5 }), ctx);
    expect(res.status).toBe(400);
  });

  it("product id non-uuid → 400", async () => {
    const res = await PATCH(
      makeRequest({ stock_disponible: 5 }),
      { params: { id: "not-a-uuid" } },
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/producer/products/[id] — ownership", () => {
  it("product introuvable → 404", async () => {
    defaultProducerOk();
    pushResp("products", "select", { data: null, error: null });
    const res = await PATCH(makeRequest({ stock_disponible: 5 }), ctx);
    expect(res.status).toBe(404);
  });

  it("product owned par autre producer → 403", async () => {
    defaultProducerOk();
    pushResp("products", "select", {
      data: {
        id: PRODUCT_ID,
        producer_id: "other-producer-uuid",
        stock_disponible: 0,
        stock_illimite: false,
      },
      error: null,
    });
    const res = await PATCH(makeRequest({ stock_disponible: 5 }), ctx);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/producer/products/[id] — UPDATE + happy path", () => {
  it("UPDATE OK → 200 + payload + UPDATE seulement les fields fournis", async () => {
    defaultProducerOk();
    defaultProductIndispoOwnedByProducer();
    pushResp("products", "update", { data: null, error: null });
    // Pas de notify (le test sera dans la suite hook)
    mockNotifyBackInStock.mockResolvedValueOnce({
      sent: 0,
      failed: 0,
      skipped: 0,
    });

    const res = await PATCH(makeRequest({ stock_disponible: 5 }), ctx);
    expect(res.status).toBe(200);

    // UPDATE déclenché avec exactement les fields fournis
    expect(captured.updates).toHaveLength(1);
    const payload = captured.updates[0].payload as Record<string, unknown>;
    expect(payload.stock_disponible).toBe(5);
    expect(payload.stock_illimite).toBeUndefined();
    expect(payload.active).toBeUndefined();
    // eq sur id
    expect(captured.eqCalls).toContainEqual({
      table: "products",
      col: "id",
      val: PRODUCT_ID,
    });
  });

  it("erreur UPDATE → 500", async () => {
    defaultProducerOk();
    defaultProductIndispoOwnedByProducer();
    pushResp("products", "update", {
      data: null,
      error: { message: "update fail" },
    });
    const res = await PATCH(makeRequest({ stock_disponible: 5 }), ctx);
    expect(res.status).toBe(500);
    expect(mockNotifyBackInStock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/producer/products/[id] — hook notify", () => {
  it("transition indispo (stock=0) → dispo (stock>0) déclenche notify", async () => {
    defaultProducerOk();
    pushResp("products", "select", {
      data: {
        id: PRODUCT_ID,
        producer_id: PRODUCER_ID,
        stock_disponible: 0,
        stock_illimite: false,
      },
      error: null,
    });
    pushResp("products", "update", { data: null, error: null });
    mockNotifyBackInStock.mockResolvedValueOnce({
      sent: 3,
      failed: 0,
      skipped: 0,
    });

    const res = await PATCH(makeRequest({ stock_disponible: 10 }), ctx);
    expect(res.status).toBe(200);
    expect(mockNotifyBackInStock).toHaveBeenCalledWith(
      expect.anything(),
      PRODUCT_ID,
    );
  });

  it("transition indispo → dispo via stock_illimite=true déclenche notify", async () => {
    defaultProducerOk();
    pushResp("products", "select", {
      data: {
        id: PRODUCT_ID,
        producer_id: PRODUCER_ID,
        stock_disponible: 0,
        stock_illimite: false,
      },
      error: null,
    });
    pushResp("products", "update", { data: null, error: null });
    mockNotifyBackInStock.mockResolvedValueOnce({
      sent: 1,
      failed: 0,
      skipped: 0,
    });

    const res = await PATCH(makeRequest({ stock_illimite: true }), ctx);
    expect(res.status).toBe(200);
    expect(mockNotifyBackInStock).toHaveBeenCalledWith(
      expect.anything(),
      PRODUCT_ID,
    );
  });

  it("stock déjà > 0 (5 → 10) ne déclenche PAS notify", async () => {
    defaultProducerOk();
    pushResp("products", "select", {
      data: {
        id: PRODUCT_ID,
        producer_id: PRODUCER_ID,
        stock_disponible: 5,
        stock_illimite: false,
      },
      error: null,
    });
    pushResp("products", "update", { data: null, error: null });

    const res = await PATCH(makeRequest({ stock_disponible: 10 }), ctx);
    expect(res.status).toBe(200);
    expect(mockNotifyBackInStock).not.toHaveBeenCalled();
  });

  it("stock reste à 0 (0 → 0) ne déclenche PAS notify", async () => {
    defaultProducerOk();
    defaultProductIndispoOwnedByProducer();
    pushResp("products", "update", { data: null, error: null });

    // Body actif mais stock identique → pas de transition
    const res = await PATCH(makeRequest({ active: true }), ctx);
    expect(res.status).toBe(200);
    expect(mockNotifyBackInStock).not.toHaveBeenCalled();
  });

  it("stock illimité déjà actif ne déclenche PAS notify (was dispo)", async () => {
    defaultProducerOk();
    pushResp("products", "select", {
      data: {
        id: PRODUCT_ID,
        producer_id: PRODUCER_ID,
        stock_disponible: 0,
        stock_illimite: true, // déjà dispo
      },
      error: null,
    });
    pushResp("products", "update", { data: null, error: null });

    const res = await PATCH(makeRequest({ active: true }), ctx);
    expect(res.status).toBe(200);
    expect(mockNotifyBackInStock).not.toHaveBeenCalled();
  });

  it("notify throws → 200 quand même (best-effort) + console.error", async () => {
    defaultProducerOk();
    defaultProductIndispoOwnedByProducer();
    pushResp("products", "update", { data: null, error: null });
    mockNotifyBackInStock.mockRejectedValueOnce(new Error("notify boom"));

    const res = await PATCH(makeRequest({ stock_disponible: 5 }), ctx);
    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

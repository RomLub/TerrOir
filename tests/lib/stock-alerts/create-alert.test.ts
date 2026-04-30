// Tests vitest pour lib/stock-alerts/create-alert.ts — création + résurrection.
//
// Stratégie : mock SupabaseClient injecté via argument (pattern aligné
// tests/lib/gms-prices/admin-write.test.ts). Capture les appels from/insert/
// update/select/eq/single/maybeSingle dans `captured` et permet d'enqueuer
// des réponses par (table, op).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createStockAlert } from "@/lib/stock-alerts/create-alert";

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
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
  op: "select" | "update" | "insert",
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
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        builder._op = "insert";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.single = () => Promise.resolve(consume(table, builder._op));
      builder.maybeSingle = () =>
        Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  } as unknown as SupabaseClient;
}

const PRODUCT_ID = "product-uuid-1";
const EMAIL = "consumer@example.com";
const CONSUMER_ID = "consumer-uuid-1";
const ROW_ID = "row-uuid-1";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    inserts: [],
    eqCalls: [],
  };
  responses = {};
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createStockAlert — INSERT initial (pas d'alerte existante)", () => {
  it("succès → ok:true + tokens + already_active=false, payload INSERT correct", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: { id: ROW_ID },
      error: null,
    });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: CONSUMER_ID,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(ROW_ID);
    expect(res.data.already_active).toBe(false);
    expect(res.data.confirm_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(res.data.unsubscribe_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(res.data.confirm_token).not.toBe(res.data.unsubscribe_token);
    // Payload INSERT
    const payload = captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.product_id).toBe(PRODUCT_ID);
    expect(payload.email).toBe(EMAIL);
    expect(payload.consumer_id).toBe(CONSUMER_ID);
    expect(payload.confirm_token).toBe(res.data.confirm_token);
    expect(payload.unsubscribe_token).toBe(res.data.unsubscribe_token);
  });

  it("consumer_id null (anonyme) accepté tel quel dans le payload", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: { id: ROW_ID },
      error: null,
    });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: null,
    });
    expect(res.ok).toBe(true);
    const payload = captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.consumer_id).toBeNull();
  });

  it("normalisation email : trim + lowercase avant INSERT (defense-in-depth)", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: { id: ROW_ID },
      error: null,
    });
    const client = buildMockClient();
    await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: "  Consumer@Example.COM  ",
      consumer_id: null,
    });
    const payload = captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.email).toBe("consumer@example.com");
  });

  it("erreur DB non-conflit → ok:false + error.message + console.error", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: null,
      error: { message: "connection lost", code: "08000" },
    });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("connection lost");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(captured.fromCalls).toEqual(["product_stock_alerts"]); // pas de fallback SELECT
  });

  it("INSERT renvoie data=null sans error → ok:false (cas dégénéré)", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: null,
      error: null,
    });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: null,
    });
    expect(res.ok).toBe(false);
  });
});

describe("createStockAlert — conflit UNIQUE (alerte existante)", () => {
  it("alerte existante confirmée + non unsubscribed → already_active=true, tokens null, pas d'UPDATE", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    });
    pushResp("product_stock_alerts", "select", {
      data: {
        id: ROW_ID,
        confirmed_at: "2026-04-20T10:00:00.000Z",
        unsubscribed_at: null,
      },
      error: null,
    });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: CONSUMER_ID,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(ROW_ID);
    expect(res.data.already_active).toBe(true);
    expect(res.data.confirm_token).toBeNull();
    expect(res.data.unsubscribe_token).toBeNull();
    // Pas d'UPDATE déclenché.
    expect(captured.updates).toHaveLength(0);
    expect(captured.fromCalls).toEqual([
      "product_stock_alerts",
      "product_stock_alerts",
    ]);
  });

  it("alerte existante non confirmée → résurrection (UPDATE reset state + nouveaux tokens)", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    });
    pushResp("product_stock_alerts", "select", {
      data: {
        id: ROW_ID,
        confirmed_at: null,
        unsubscribed_at: null,
      },
      error: null,
    });
    pushResp("product_stock_alerts", "update", { data: null, error: null });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: CONSUMER_ID,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(ROW_ID);
    expect(res.data.already_active).toBe(false);
    expect(res.data.confirm_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(res.data.unsubscribe_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // UPDATE déclenché avec reset complet du state
    expect(captured.updates).toHaveLength(1);
    const payload = captured.updates[0].payload as Record<string, unknown>;
    expect(payload.confirmed_at).toBeNull();
    expect(payload.unsubscribed_at).toBeNull();
    expect(payload.notified_at).toBeNull();
    expect(payload.confirm_token).toBe(res.data.confirm_token);
    expect(payload.unsubscribe_token).toBe(res.data.unsubscribe_token);
    expect(payload.consumer_id).toBe(CONSUMER_ID);
    expect(typeof payload.created_at).toBe("string");
    // eq sur id pour UPDATE
    expect(captured.eqCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "id",
      val: ROW_ID,
    });
  });

  it("alerte existante unsubscribed → résurrection (UPDATE reset state + nouveaux tokens)", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    });
    pushResp("product_stock_alerts", "select", {
      data: {
        id: ROW_ID,
        confirmed_at: "2026-04-15T10:00:00.000Z",
        unsubscribed_at: "2026-04-20T10:00:00.000Z",
      },
      error: null,
    });
    pushResp("product_stock_alerts", "update", { data: null, error: null });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: CONSUMER_ID,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.already_active).toBe(false);
    expect(res.data.confirm_token).not.toBeNull();
    expect(captured.updates).toHaveLength(1);
    const payload = captured.updates[0].payload as Record<string, unknown>;
    expect(payload.unsubscribed_at).toBeNull();
    expect(payload.confirmed_at).toBeNull();
  });

  it("conflit UNIQUE + SELECT échoue → ok:false + console.error", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    });
    pushResp("product_stock_alerts", "select", {
      data: null,
      error: { message: "select failed" },
    });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("select failed");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("conflit UNIQUE + résurrection UPDATE échoue → ok:false + console.error", async () => {
    pushResp("product_stock_alerts", "insert", {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    });
    pushResp("product_stock_alerts", "select", {
      data: {
        id: ROW_ID,
        confirmed_at: null,
        unsubscribed_at: null,
      },
      error: null,
    });
    pushResp("product_stock_alerts", "update", {
      data: null,
      error: { message: "update failed" },
    });
    const client = buildMockClient();
    const res = await createStockAlert(client, {
      product_id: PRODUCT_ID,
      email: EMAIL,
      consumer_id: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("update failed");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

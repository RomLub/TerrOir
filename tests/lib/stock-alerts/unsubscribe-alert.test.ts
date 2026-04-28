// Tests vitest pour lib/stock-alerts/unsubscribe-alert.ts (opt-out via token).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { unsubscribeStockAlert } from "@/lib/stock-alerts/unsubscribe-alert";

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

const TOKEN = "abcdefghijklmnopqrstuvwxyz123456";
const ROW_ID = "row-uuid-1";
const PRODUCT_ID = "product-uuid-1";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = { fromCalls: [], selects: [], updates: [], eqCalls: [] };
  responses = {};
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unsubscribeStockAlert", () => {
  it("token vide → invalid_token, pas d'appel DB", async () => {
    const client = buildMockClient();
    const res = await unsubscribeStockAlert(client, "");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_token");
    expect(captured.fromCalls).toEqual([]);
  });

  it("token inexistant en DB → invalid_token", async () => {
    pushResp("product_stock_alerts", "select", { data: null, error: null });
    const client = buildMockClient();
    const res = await unsubscribeStockAlert(client, TOKEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_token");
    expect(captured.updates).toHaveLength(0);
  });

  it("row déjà unsubscribed → ok already_unsubscribed=true (idempotent), pas d'UPDATE", async () => {
    pushResp("product_stock_alerts", "select", {
      data: {
        id: ROW_ID,
        product_id: PRODUCT_ID,
        unsubscribed_at: "2026-04-20T10:00:00.000Z",
      },
      error: null,
    });
    const client = buildMockClient();
    const res = await unsubscribeStockAlert(client, TOKEN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(ROW_ID);
    expect(res.data.product_id).toBe(PRODUCT_ID);
    expect(res.data.already_unsubscribed).toBe(true);
    expect(captured.updates).toHaveLength(0);
  });

  it("row valide → UPDATE unsubscribed_at + ok already_unsubscribed=false", async () => {
    pushResp("product_stock_alerts", "select", {
      data: {
        id: ROW_ID,
        product_id: PRODUCT_ID,
        unsubscribed_at: null,
      },
      error: null,
    });
    pushResp("product_stock_alerts", "update", { data: null, error: null });
    const client = buildMockClient();
    const res = await unsubscribeStockAlert(client, TOKEN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(ROW_ID);
    expect(res.data.already_unsubscribed).toBe(false);
    expect(captured.updates).toHaveLength(1);
    const payload = captured.updates[0].payload as Record<string, unknown>;
    expect(typeof payload.unsubscribed_at).toBe("string");
    expect(captured.eqCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "id",
      val: ROW_ID,
    });
  });

  it("erreur DB sur SELECT → db_error + console.error", async () => {
    pushResp("product_stock_alerts", "select", {
      data: null,
      error: { message: "db down" },
    });
    const client = buildMockClient();
    const res = await unsubscribeStockAlert(client, TOKEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("db_error");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("erreur DB sur UPDATE → db_error + console.error", async () => {
    pushResp("product_stock_alerts", "select", {
      data: {
        id: ROW_ID,
        product_id: PRODUCT_ID,
        unsubscribed_at: null,
      },
      error: null,
    });
    pushResp("product_stock_alerts", "update", {
      data: null,
      error: { message: "update fail" },
    });
    const client = buildMockClient();
    const res = await unsubscribeStockAlert(client, TOKEN);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("db_error");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

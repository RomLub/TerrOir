// Tests vitest pour lib/stock-alerts/fetch-producer-alerts.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchProducerAlerts } from "@/lib/stock-alerts/fetch-producer-alerts";

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  isCalls: Array<{ table: string; col: string; val: unknown }>;
  notCalls: Array<{ table: string; col: string; op: string; val: unknown }>;
  inCalls: Array<{ table: string; col: string; vals: unknown[] }>;
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
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.is = (col: string, val: unknown) => {
        captured.isCalls.push({ table, col, val });
        return builder;
      };
      builder.not = (col: string, op: string, val: unknown) => {
        captured.notCalls.push({ table, col, op, val });
        return builder;
      };
      builder.in = (col: string, vals: unknown[]) => {
        captured.inCalls.push({ table, col, vals });
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

const PRODUCER_ID = "producer-uuid-1";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    eqCalls: [],
    isCalls: [],
    notCalls: [],
    inCalls: [],
  };
  responses = {};
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchProducerAlerts", () => {
  it("producer sans produits → []", async () => {
    pushResp("products", "select", { data: [], error: null });
    const client = buildMockClient();
    const res = await fetchProducerAlerts(client, PRODUCER_ID);
    expect(res).toEqual([]);
    // Pas de SELECT alerts (short-circuit)
    expect(captured.fromCalls).toEqual(["products"]);
  });

  it("erreur fetch products → [] + console.error", async () => {
    pushResp("products", "select", {
      data: null,
      error: { message: "db down" },
    });
    const client = buildMockClient();
    const res = await fetchProducerAlerts(client, PRODUCER_ID);
    expect(res).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("erreur fetch alerts → [] + console.error", async () => {
    pushResp("products", "select", {
      data: [{ id: "p1", nom: "Faux-filet" }],
      error: null,
    });
    pushResp("product_stock_alerts", "select", {
      data: null,
      error: { message: "alerts query fail" },
    });
    const client = buildMockClient();
    const res = await fetchProducerAlerts(client, PRODUCER_ID);
    expect(res).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("produits sans aucune alerte → [] (filtre count > 0)", async () => {
    pushResp("products", "select", {
      data: [
        { id: "p1", nom: "Faux-filet" },
        { id: "p2", nom: "Côte" },
      ],
      error: null,
    });
    pushResp("product_stock_alerts", "select", { data: [], error: null });
    const client = buildMockClient();
    const res = await fetchProducerAlerts(client, PRODUCER_ID);
    expect(res).toEqual([]);
  });

  it("produits avec alertes mixtes → group + tri DESC + filter count > 0", async () => {
    pushResp("products", "select", {
      data: [
        { id: "p1", nom: "Faux-filet" }, // 3 alertes attendues
        { id: "p2", nom: "Côte" }, // 1 alerte
        { id: "p3", nom: "Bavette" }, // 0 alerte → filtré
      ],
      error: null,
    });
    pushResp("product_stock_alerts", "select", {
      data: [
        { product_id: "p1" },
        { product_id: "p1" },
        { product_id: "p1" },
        { product_id: "p2" },
      ],
      error: null,
    });
    const client = buildMockClient();
    const res = await fetchProducerAlerts(client, PRODUCER_ID);
    expect(res).toEqual([
      { product_id: "p1", product_name: "Faux-filet", count: 3 },
      { product_id: "p2", product_name: "Côte", count: 1 },
    ]);
    // Bavette absent (count=0)
    expect(res.find((r) => r.product_id === "p3")).toBeUndefined();
  });

  it("requête alerts utilise IN sur productIds + filtres actifs", async () => {
    pushResp("products", "select", {
      data: [
        { id: "p1", nom: "A" },
        { id: "p2", nom: "B" },
      ],
      error: null,
    });
    pushResp("product_stock_alerts", "select", { data: [], error: null });
    const client = buildMockClient();
    await fetchProducerAlerts(client, PRODUCER_ID);
    // .in("product_id", ["p1", "p2"])
    expect(captured.inCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "product_id",
      vals: ["p1", "p2"],
    });
    // .not("confirmed_at", "is", null)
    expect(captured.notCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "confirmed_at",
      op: "is",
      val: null,
    });
    // .is("notified_at", null) + .is("unsubscribed_at", null)
    expect(captured.isCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "notified_at",
      val: null,
    });
    expect(captured.isCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "unsubscribed_at",
      val: null,
    });
  });
});

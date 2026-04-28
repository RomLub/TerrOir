// Tests vitest pour GET/POST /api/cron/purge-stock-alerts.
// Pattern aligné cron/order-timeout : auth Bearer CRON_SECRET, 2 DELETEs
// avec count exact, retour JSON { purged_notified, purged_unconfirmed }.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.hoisted(() => {
  process.env.CRON_SECRET = process.env.CRON_SECRET ?? "test-cron-secret";
});

vi.mock("server-only", () => ({}));

const { mockClientHolder } = vi.hoisted(() => ({
  mockClientHolder: { current: null as SupabaseClient | null },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockClientHolder.current!,
}));

import { POST } from "@/app/api/cron/purge-stock-alerts/route";

type DeleteResp = { count?: number | null; error?: { message: string } | null };
type Op = "delete" | "pending";

type Captured = {
  fromCalls: string[];
  deleteCalls: Array<{ table: string; opts: unknown }>;
  notCalls: Array<{ table: string; col: string; op: string; val: unknown }>;
  isCalls: Array<{ table: string; col: string; val: unknown }>;
  ltCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let deleteResponses: DeleteResp[]; // FIFO queue, consommé par chaque DELETE await

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.delete = (opts: unknown) => {
        captured.deleteCalls.push({ table, opts });
        builder._op = "delete";
        return builder;
      };
      builder.not = (col: string, op: string, val: unknown) => {
        captured.notCalls.push({ table, col, op, val });
        return builder;
      };
      builder.is = (col: string, val: unknown) => {
        captured.isCalls.push({ table, col, val });
        return builder;
      };
      builder.lt = (col: string, val: unknown) => {
        captured.ltCalls.push({ table, col, val });
        return builder;
      };
      builder.then = (onFulfilled: (r: DeleteResp) => unknown) => {
        const resp = deleteResponses.shift() ?? { count: 0, error: null };
        return onFulfilled(resp);
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    deleteCalls: [],
    notCalls: [],
    isCalls: [],
    ltCalls: [],
  };
  deleteResponses = [];
  mockClientHolder.current = buildMockClient();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function authedRequest(): Request {
  return new Request("http://localhost/api/cron/purge-stock-alerts", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}

function unauthedRequest(): Request {
  return new Request("http://localhost/api/cron/purge-stock-alerts", {
    method: "POST",
  });
}

describe("POST /api/cron/purge-stock-alerts — auth", () => {
  it("sans Bearer → 401", async () => {
    const res = await POST(unauthedRequest());
    expect(res.status).toBe(401);
    expect(captured.fromCalls).toEqual([]); // pas d'accès DB
  });

  it("Bearer incorrect → 401", async () => {
    const req = new Request("http://localhost/api/cron/purge-stock-alerts", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/cron/purge-stock-alerts — purge", () => {
  it("2 DELETEs OK → 200 + counts cumulés", async () => {
    deleteResponses.push({ count: 5, error: null });
    deleteResponses.push({ count: 3, error: null });
    const res = await POST(authedRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.purged_notified).toBe(5);
    expect(body.purged_unconfirmed).toBe(3);
    expect(body.notified_error).toBeNull();
    expect(body.unconfirmed_error).toBeNull();
  });

  it("erreur DELETE notified → 200 + count 0 + notified_error remonté", async () => {
    deleteResponses.push({ count: null, error: { message: "delete fail 1" } });
    deleteResponses.push({ count: 7, error: null });
    const res = await POST(authedRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.purged_notified).toBe(0);
    expect(body.purged_unconfirmed).toBe(7);
    expect(body.notified_error).toBe("delete fail 1");
    expect(body.unconfirmed_error).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("erreur DELETE unconfirmed → 200 + count 0 + unconfirmed_error remonté", async () => {
    deleteResponses.push({ count: 2, error: null });
    deleteResponses.push({ count: null, error: { message: "delete fail 2" } });
    const res = await POST(authedRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.purged_notified).toBe(2);
    expect(body.purged_unconfirmed).toBe(0);
    expect(body.unconfirmed_error).toBe("delete fail 2");
  });

  it("DELETE notified utilise filtre 'notified_at NOT NULL AND notified_at < (now-90j)'", async () => {
    deleteResponses.push({ count: 0, error: null });
    deleteResponses.push({ count: 0, error: null });
    await POST(authedRequest());
    expect(captured.notCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "notified_at",
      op: "is",
      val: null,
    });
    // Premier .lt() correspond au DELETE notified (notified_at < cutoff90)
    expect(captured.ltCalls[0].col).toBe("notified_at");
    const cutoff90 = new Date(captured.ltCalls[0].val as string).getTime();
    const expected = Date.now() - 90 * 24 * 60 * 60 * 1000;
    // tolérance ±10s pour différence d'horloge entre le test et la route
    expect(Math.abs(cutoff90 - expected)).toBeLessThan(10_000);
  });

  it("DELETE unconfirmed utilise filtre 'confirmed_at IS NULL AND created_at < (now-7j)'", async () => {
    deleteResponses.push({ count: 0, error: null });
    deleteResponses.push({ count: 0, error: null });
    await POST(authedRequest());
    expect(captured.isCalls).toContainEqual({
      table: "product_stock_alerts",
      col: "confirmed_at",
      val: null,
    });
    expect(captured.ltCalls[1].col).toBe("created_at");
    const cutoff7 = new Date(captured.ltCalls[1].val as string).getTime();
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff7 - expected)).toBeLessThan(10_000);
  });

  it("DELETE appelé avec count: 'exact' (Supabase JS retourne count)", async () => {
    deleteResponses.push({ count: 0, error: null });
    deleteResponses.push({ count: 0, error: null });
    await POST(authedRequest());
    expect(captured.deleteCalls[0].opts).toEqual({ count: "exact" });
    expect(captured.deleteCalls[1].opts).toEqual({ count: "exact" });
  });
});

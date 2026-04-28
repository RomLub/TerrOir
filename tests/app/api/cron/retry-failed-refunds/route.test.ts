import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Hoisted mocks BEFORE route import — pattern cron tests existants.
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/stripe/retry-failed-refund", () => ({
  retryFailedRefund: vi.fn(),
}));

import { POST } from "@/app/api/cron/retry-failed-refunds/route";
import { buildRetryTargets } from "@/lib/cron/build-retry-targets";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { retryFailedRefund } from "@/lib/stripe/retry-failed-refund";

// =============================================================================
// Mock Supabase admin — chaque appel `from(table)` retourne un builder neuf.
// La route fait :
//   1. from('audit_logs').select(...).in(...).order(...).limit(...)
//      → thenable resp.
//   2. from('orders').select(...).in('id', orderIds)
//      → thenable resp.
// =============================================================================
type ChainResp = { data?: unknown; error?: unknown };

interface SupabaseControl {
  auditLogs?: ChainResp;
  orders?: ChainResp;
}

function makeSupabase(ctrl: SupabaseControl = {}): {
  client: SupabaseClient;
  fromCalls: string[];
} {
  const fromCalls: string[] = [];

  const buildBuilder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = (_cols: string) => b;
    b.in = (_col: string, _vals: unknown) => b;
    b.order = (_col: string, _opts: unknown) => b;
    b.limit = (_n: number) => b;
    b.then = (onFulfilled: (r: ChainResp) => unknown) => {
      const resp =
        table === "audit_logs"
          ? (ctrl.auditLogs ?? { data: [], error: null })
          : (ctrl.orders ?? { data: [], error: null });
      return onFulfilled(resp);
    };
    return b;
  };

  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      return buildBuilder(table);
    },
  } as unknown as SupabaseClient;

  return { client, fromCalls };
}

function makeRequest(opts: { auth?: string } = {}): Request {
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  return new Request("http://localhost/api/cron/retry-failed-refunds", {
    method: "POST",
    headers,
  });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(retryFailedRefund).mockReset();
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_CRON_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  }
});

// =============================================================================
// buildRetryTargets — pure function tests (pas d'IO, pas de Supabase).
// =============================================================================

describe("buildRetryTargets — pure function", () => {
  it("returns empty when no audit log events", () => {
    const { targets, skipped } = buildRetryTargets([]);
    expect(targets).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("skips orders that have already retried_succeeded", () => {
    const events = [
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-1",
          payment_intent_id: "pi_1",
          blocked_reason: "blocked_stock",
        },
        created_at: "2026-04-25T10:00:00.000Z",
      },
      {
        event_type: "order_refund_retried_succeeded",
        metadata: { order_id: "order-1", attempt: 1 },
        created_at: "2026-04-26T10:00:00.000Z",
      },
    ];
    const { targets } = buildRetryTargets(events);
    expect(targets).toEqual([]);
  });

  it("skips orders that have already retry_exhausted", () => {
    const events = [
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-2",
          payment_intent_id: "pi_2",
          blocked_reason: "blocked_slot",
        },
        created_at: "2026-04-25T10:00:00.000Z",
      },
      {
        event_type: "order_refund_retry_exhausted",
        metadata: { order_id: "order-2" },
        created_at: "2026-04-28T10:00:00.000Z",
      },
    ];
    const { targets } = buildRetryTargets(events);
    expect(targets).toEqual([]);
  });

  it("attempt=1 when only the initial webhook failed event exists", () => {
    const events = [
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-3",
          payment_intent_id: "pi_3",
          blocked_reason: "blocked_stock",
        },
        created_at: "2026-04-27T10:00:00.000Z",
      },
    ];
    const { targets, skipped } = buildRetryTargets(events);
    expect(skipped).toEqual([]);
    expect(targets).toEqual([
      {
        orderId: "order-3",
        paymentIntentId: "pi_3",
        blockedReason: "blocked_stock",
        attempt: 1,
      },
    ]);
  });

  it("attempt=2 after one failed retry (2 refund_failed events)", () => {
    const events = [
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-4",
          payment_intent_id: "pi_4",
          blocked_reason: "blocked_slot",
        },
        created_at: "2026-04-25T10:00:00.000Z",
      },
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-4",
          payment_intent_id: "pi_4",
          blocked_reason: "blocked_slot",
          attempt: 1,
        },
        created_at: "2026-04-26T10:00:00.000Z",
      },
    ];
    const { targets } = buildRetryTargets(events);
    expect(targets).toEqual([
      {
        orderId: "order-4",
        paymentIntentId: "pi_4",
        blockedReason: "blocked_slot",
        attempt: 2,
      },
    ]);
  });

  it("attempt=3 after two failed retries (3 refund_failed events)", () => {
    const baseMeta = {
      order_id: "order-5",
      payment_intent_id: "pi_5",
      blocked_reason: "blocked_stock",
    };
    const events = [
      {
        event_type: "order_revival_refund_failed",
        metadata: baseMeta,
        created_at: "2026-04-25T10:00:00.000Z",
      },
      {
        event_type: "order_revival_refund_failed",
        metadata: { ...baseMeta, attempt: 1 },
        created_at: "2026-04-26T10:00:00.000Z",
      },
      {
        event_type: "order_revival_refund_failed",
        metadata: { ...baseMeta, attempt: 2 },
        created_at: "2026-04-27T10:00:00.000Z",
      },
    ];
    const { targets } = buildRetryTargets(events);
    expect(targets).toEqual([
      {
        orderId: "order-5",
        paymentIntentId: "pi_5",
        blockedReason: "blocked_stock",
        attempt: 3,
      },
    ]);
  });

  it("defensive: skips orders with ≥4 refund_failed events without exhausted (audit incohérent)", () => {
    const baseMeta = {
      order_id: "order-incoherent",
      payment_intent_id: "pi_x",
      blocked_reason: "blocked_stock",
    };
    const events = Array.from({ length: 4 }, (_, i) => ({
      event_type: "order_revival_refund_failed",
      metadata: { ...baseMeta, attempt: i },
      created_at: `2026-04-2${i + 4}T10:00:00.000Z`,
    }));
    const { targets, skipped } = buildRetryTargets(events);
    expect(targets).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.result).toBe("skipped_invalid_metadata");
    expect(skipped[0]?.error).toContain("failed_count=4");
  });

  it("defensive: skips events with missing payment_intent_id or blocked_reason", () => {
    const events = [
      {
        event_type: "order_revival_refund_failed",
        metadata: { order_id: "order-bad" }, // missing pi + blocked_reason
        created_at: "2026-04-25T10:00:00.000Z",
      },
    ];
    const { targets, skipped } = buildRetryTargets(events);
    expect(targets).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.error).toContain(
      "missing payment_intent_id or blocked_reason",
    );
  });

  it("uses the most recent refund_failed event for payment_intent_id + blocked_reason", () => {
    // Si entre 2 attempts l'order avait des metadata différentes (cas patho
    // mais théorique), on prend le dernier event posé (le plus récent).
    const events = [
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-6",
          payment_intent_id: "pi_old",
          blocked_reason: "blocked_stock",
        },
        created_at: "2026-04-25T10:00:00.000Z",
      },
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-6",
          payment_intent_id: "pi_new",
          blocked_reason: "blocked_slot",
          attempt: 1,
        },
        created_at: "2026-04-27T10:00:00.000Z",
      },
    ];
    const { targets } = buildRetryTargets(events);
    expect(targets).toEqual([
      {
        orderId: "order-6",
        paymentIntentId: "pi_new",
        blockedReason: "blocked_slot",
        attempt: 2,
      },
    ]);
  });

  it("handles multiple distinct orders in a single batch", () => {
    const events = [
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-A",
          payment_intent_id: "pi_A",
          blocked_reason: "blocked_stock",
        },
        created_at: "2026-04-26T10:00:00.000Z",
      },
      {
        event_type: "order_refund_retried_succeeded",
        metadata: { order_id: "order-B" },
        created_at: "2026-04-27T10:00:00.000Z",
      },
      {
        event_type: "order_revival_refund_failed",
        metadata: {
          order_id: "order-C",
          payment_intent_id: "pi_C",
          blocked_reason: "blocked_slot",
        },
        created_at: "2026-04-26T10:00:00.000Z",
      },
    ];
    const { targets } = buildRetryTargets(events);
    // order-B exclu (retried_succeeded), order-A et order-C eligibles attempt=1.
    const ids = targets.map((t) => t.orderId).sort();
    expect(ids).toEqual(["order-A", "order-C"]);
  });
});

// =============================================================================
// POST — auth
// =============================================================================

describe("POST /api/cron/retry-failed-refunds — auth", () => {
  it("401 when authorization header missing", async () => {
    const { client } = makeSupabase();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(vi.mocked(retryFailedRefund)).not.toHaveBeenCalled();
  });

  it("401 when authorization header does not match Bearer <CRON_SECRET>", async () => {
    const { client } = makeSupabase();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(vi.mocked(retryFailedRefund)).not.toHaveBeenCalled();
  });

  it("500 when CRON_SECRET env var not configured", async () => {
    delete process.env.CRON_SECRET;
    const { client } = makeSupabase();
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
  });
});

// =============================================================================
// POST — integration paths
// =============================================================================

describe("POST /api/cron/retry-failed-refunds — integration", () => {
  it("returns processed=0 when no audit log events match", async () => {
    const { client, fromCalls } = makeSupabase({
      auditLogs: { data: [], error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ processed: 0, results: [] });

    // SELECT audit_logs only — pas de SELECT orders ni de retryFailedRefund.
    expect(fromCalls).toEqual(["audit_logs"]);
    expect(vi.mocked(retryFailedRefund)).not.toHaveBeenCalled();
  });

  it("returns 500 with PostgREST error message when audit_logs SELECT fails", async () => {
    const { client } = makeSupabase({
      auditLogs: { data: null, error: { message: "table down" } },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("table down");
    expect(vi.mocked(retryFailedRefund)).not.toHaveBeenCalled();
  });

  it("eligible target attempt=1 → retryFailedRefund called once with correct params + consumer_id from orders", async () => {
    const { client } = makeSupabase({
      auditLogs: {
        data: [
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-42",
              payment_intent_id: "pi_42",
              blocked_reason: "blocked_stock",
            },
            created_at: "2026-04-27T10:00:00.000Z",
          },
        ],
        error: null,
      },
      orders: {
        data: [{ id: "order-42", consumer_id: "user-7" }],
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(retryFailedRefund).mockResolvedValue("succeeded");

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    expect(vi.mocked(retryFailedRefund)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(retryFailedRefund)).toHaveBeenCalledWith({
      orderId: "order-42",
      paymentIntentId: "pi_42",
      attempt: 1,
      blockedReason: "blocked_stock",
      consumerId: "user-7",
      admin: client,
    });

    expect(body.processed).toBe(1);
    expect(body.results).toEqual([
      { order_id: "order-42", attempt: 1, result: "succeeded" },
    ]);
  });

  it("order RGPD-deleted → retry called with consumerId=null", async () => {
    const { client } = makeSupabase({
      auditLogs: {
        data: [
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-deleted",
              payment_intent_id: "pi_deleted",
              blocked_reason: "blocked_slot",
            },
            created_at: "2026-04-27T10:00:00.000Z",
          },
        ],
        error: null,
      },
      orders: { data: [], error: null }, // order disparue (RGPD)
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(retryFailedRefund).mockResolvedValue("failed_will_retry");

    await POST(makeRequest({ auth: "Bearer test-secret" }));

    expect(vi.mocked(retryFailedRefund)).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-deleted",
        consumerId: null,
      }),
    );
  });

  it("target already retried_succeeded → skipped, no retry call", async () => {
    const { client } = makeSupabase({
      auditLogs: {
        data: [
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-done",
              payment_intent_id: "pi_done",
              blocked_reason: "blocked_stock",
            },
            created_at: "2026-04-25T10:00:00.000Z",
          },
          {
            event_type: "order_refund_retried_succeeded",
            metadata: { order_id: "order-done" },
            created_at: "2026-04-26T10:00:00.000Z",
          },
        ],
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ processed: 0, results: [] });
    expect(vi.mocked(retryFailedRefund)).not.toHaveBeenCalled();
  });

  it("batch with 3 orders : eligible / done / exhausted → seul l'eligible est retried", async () => {
    const { client } = makeSupabase({
      auditLogs: {
        data: [
          // order-eligible : 1 fail event seulement → attempt 1
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-eligible",
              payment_intent_id: "pi_eligible",
              blocked_reason: "blocked_stock",
            },
            created_at: "2026-04-27T10:00:00.000Z",
          },
          // order-done : refund_failed + retried_succeeded → skip
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-done",
              payment_intent_id: "pi_done",
              blocked_reason: "blocked_slot",
            },
            created_at: "2026-04-25T10:00:00.000Z",
          },
          {
            event_type: "order_refund_retried_succeeded",
            metadata: { order_id: "order-done" },
            created_at: "2026-04-26T10:00:00.000Z",
          },
          // order-exhausted : 3 fails + exhausted → skip
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-exhausted",
              payment_intent_id: "pi_exhausted",
              blocked_reason: "blocked_stock",
            },
            created_at: "2026-04-25T10:00:00.000Z",
          },
          {
            event_type: "order_refund_retry_exhausted",
            metadata: { order_id: "order-exhausted" },
            created_at: "2026-04-28T10:00:00.000Z",
          },
        ],
        error: null,
      },
      orders: {
        data: [{ id: "order-eligible", consumer_id: "user-9" }],
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(retryFailedRefund).mockResolvedValue("succeeded");

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);

    expect(vi.mocked(retryFailedRefund)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(retryFailedRefund)).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-eligible" }),
    );
  });

  it("multiple eligible targets processed in sequence (3 retries called)", async () => {
    const { client } = makeSupabase({
      auditLogs: {
        data: [
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-A",
              payment_intent_id: "pi_A",
              blocked_reason: "blocked_stock",
            },
            created_at: "2026-04-27T10:00:00.000Z",
          },
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-B",
              payment_intent_id: "pi_B",
              blocked_reason: "blocked_slot",
            },
            created_at: "2026-04-27T10:00:00.000Z",
          },
          {
            event_type: "order_revival_refund_failed",
            metadata: {
              order_id: "order-C",
              payment_intent_id: "pi_C",
              blocked_reason: "blocked_stock",
            },
            created_at: "2026-04-27T10:00:00.000Z",
          },
        ],
        error: null,
      },
      orders: {
        data: [
          { id: "order-A", consumer_id: "user-A" },
          { id: "order-B", consumer_id: "user-B" },
          { id: "order-C", consumer_id: null },
        ],
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(retryFailedRefund)
      .mockResolvedValueOnce("succeeded")
      .mockResolvedValueOnce("failed_will_retry")
      .mockResolvedValueOnce("failed_exhausted");

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    expect(vi.mocked(retryFailedRefund)).toHaveBeenCalledTimes(3);
    expect(body.processed).toBe(3);

    // Chaque résultat capturé avec son order_id + attempt + result.
    const byOrder = Object.fromEntries(
      body.results.map((r) => [r.order_id as string, r]),
    );
    expect(byOrder["order-A"]).toMatchObject({ result: "succeeded", attempt: 1 });
    expect(byOrder["order-B"]).toMatchObject({
      result: "failed_will_retry",
      attempt: 1,
    });
    expect(byOrder["order-C"]).toMatchObject({
      result: "failed_exhausted",
      attempt: 1,
    });
  });
});

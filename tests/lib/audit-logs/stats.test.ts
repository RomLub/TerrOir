import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock du client admin AVANT import du module testé. On instrumente
// chaque appel `.from('audit_logs')` distinct via une queue de results :
// 1) today count, 2) last7 count, 3) failed7 count, 4) top type fetch.
type Builder = {
  select: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then?: never;
};

const { mockFrom, queue } = vi.hoisted(() => {
  const queue: Array<unknown> = [];
  function makeBuilder(result: unknown): Builder {
    const promise = Promise.resolve(result);
    const builder: Builder = {
      select: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      lt: vi.fn(() => builder),
      in: vi.fn(() => builder),
      limit: vi.fn(() => builder),
    };
    // Make builder thenable so `await` resolves to result
    (builder as unknown as { then: unknown }).then = (
      onF: (v: unknown) => unknown,
    ) => promise.then(onF);
    return builder;
  }
  const mockFrom = vi.fn(() => {
    const next = queue.shift();
    if (!next) throw new Error("no result enqueued for from() call");
    return makeBuilder(next);
  });
  return { mockFrom, queue };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockFrom }),
}));

import { getAuditLogStats, __test__ } from "@/lib/audit-logs/stats";

describe("getAuditLogStats", () => {
  beforeEach(() => {
    queue.length = 0;
    mockFrom.mockClear();
  });

  it("agrège today / last7 / failed7 / top eventType", async () => {
    queue.push({ count: 12, error: null }); // today
    queue.push({ count: 80, error: null }); // last7
    queue.push({ count: 3, error: null }); // failed7
    queue.push({
      // top type fetch
      data: [
        { event_type: "account_login_password" },
        { event_type: "account_login_password" },
        { event_type: "account_login_password" },
        { event_type: "account_logout" },
      ],
      error: null,
    });

    const stats = await getAuditLogStats(
      new Date("2026-05-06T14:00:00Z"),
    );
    expect(stats.todayCount).toBe(12);
    expect(stats.last7daysCount).toBe(80);
    expect(stats.failed7dCount).toBe(3);
    expect(stats.topEventType7d).toEqual({
      eventType: "account_login_password",
      count: 3,
    });
  });

  it("topEventType7d = null quand aucun log sur la fenêtre 7j", async () => {
    queue.push({ count: 0, error: null });
    queue.push({ count: 0, error: null });
    queue.push({ count: 0, error: null });
    queue.push({ data: [], error: null });
    const stats = await getAuditLogStats(new Date("2026-05-06T14:00:00Z"));
    expect(stats.topEventType7d).toBeNull();
  });

  it("expose la liste des event_types comptés comme 'failed7'", () => {
    expect(__test__.FAILED_PAYMENT_EVENT_TYPES).toContain(
      "order_payment_failed",
    );
    expect(__test__.FAILED_PAYMENT_EVENT_TYPES).toContain(
      "stripe_payout_failed",
    );
    expect(__test__.FAILED_PAYMENT_EVENT_TYPES).toContain(
      "order_refund_retry_exhausted",
    );
  });

  it("todayParisYyyymmdd renvoie une date au format YYYY-MM-DD", () => {
    const out = __test__.todayParisYyyymmdd(
      new Date("2026-05-06T14:00:00Z"),
    );
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

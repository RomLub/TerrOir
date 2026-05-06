import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests log-review-followup-event — pattern aligné log-pickup-event.test
// (capture insert + assertions + fail-safe).

type InsertSpy = ((table: string, payload: unknown) => Promise<unknown>) & {
  mock: { calls: unknown[][] };
};
let insertSpy: InsertSpy;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      insert: (payload: unknown) => insertSpy(table, payload),
    }),
  }),
}));

import {
  logReviewFollowupEvent,
  REVIEW_FOLLOWUP_EVENT_TYPES,
} from "@/lib/audit-logs/log-review-followup-event";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  insertSpy = vi
    .fn()
    .mockResolvedValue({ error: null }) as unknown as InsertSpy;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logReviewFollowupEvent — contrat insert", () => {
  it("insère review_followup_sent_d2 avec metadata", async () => {
    await logReviewFollowupEvent({
      eventType: "review_followup_sent_d2",
      userId: "user-1",
      metadata: {
        order_id: "order-1",
        day_offset: 2,
        code_commande: "TRR-ABCDE",
      },
    });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith("audit_logs", {
      user_id: "user-1",
      event_type: "review_followup_sent_d2",
      metadata: {
        order_id: "order-1",
        day_offset: 2,
        code_commande: "TRR-ABCDE",
      },
    });
  });

  it("insère review_followup_dedup_blocked sans erreur", async () => {
    await logReviewFollowupEvent({
      eventType: "review_followup_dedup_blocked",
      userId: "user-1",
      metadata: { order_id: "order-1", day_offset: 7 },
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.event_type).toBe("review_followup_dedup_blocked");
  });

  it("insère review_followup_skipped avec reason discriminée", async () => {
    await logReviewFollowupEvent({
      eventType: "review_followup_skipped",
      userId: "user-1",
      metadata: {
        order_id: "order-1",
        day_offset: 2,
        reason: "review_exists",
      },
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.reason).toBe("review_exists");
  });

  it("metadata par défaut = {} si non fournie", async () => {
    await logReviewFollowupEvent({
      eventType: "review_followup_sent_d7",
      userId: "user-1",
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.metadata).toEqual({});
  });

  it("userId null accepté", async () => {
    await logReviewFollowupEvent({
      eventType: "review_followup_skipped",
      userId: null,
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.user_id).toBeNull();
  });
});

describe("logReviewFollowupEvent — fail-safe", () => {
  it("DB error → swallow + console.warn (jamais throw)", async () => {
    insertSpy = vi
      .fn()
      .mockResolvedValue({
        error: { message: "audit table down" },
      }) as unknown as InsertSpy;
    await expect(
      logReviewFollowupEvent({
        eventType: "review_followup_sent_d2",
        userId: "user-1",
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("createClient throw → swallow + console.warn", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createSupabaseAdminClient: () => {
        throw new Error("env missing");
      },
    }));
    const { logReviewFollowupEvent: log } = await import(
      "@/lib/audit-logs/log-review-followup-event"
    );
    await expect(
      log({ eventType: "review_followup_sent_d2", userId: "u1" }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("REVIEW_FOLLOWUP_EVENT_TYPES — exhaustivité 4 events", () => {
  it("contient les 4 events du cluster review_followup", () => {
    expect(REVIEW_FOLLOWUP_EVENT_TYPES).toEqual([
      "review_followup_sent_d2",
      "review_followup_sent_d7",
      "review_followup_skipped",
      "review_followup_dedup_blocked",
    ]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests log-pickup-event — pattern aligné log-categorisation-event.test
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
  logPickupEvent,
  PICKUP_EVENT_TYPES,
} from "@/lib/audit-logs/log-pickup-event";

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

describe("logPickupEvent — contrat insert", () => {
  it("insère pickup_validated avec metadata complète", async () => {
    await logPickupEvent({
      eventType: "pickup_validated",
      userId: "user-prod-1",
      metadata: {
        producer_id: "prod-1",
        order_id: "order-1",
        completed_at: "2026-05-06T11:00:00Z",
      },
    });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith("audit_logs", {
      user_id: "user-prod-1",
      event_type: "pickup_validated",
      metadata: {
        producer_id: "prod-1",
        order_id: "order-1",
        completed_at: "2026-05-06T11:00:00Z",
      },
    });
  });

  it("insère pickup_attempt_invalid avec reason interne (anti-info-leakage)", async () => {
    await logPickupEvent({
      eventType: "pickup_attempt_invalid",
      userId: "user-prod-1",
      metadata: { producer_id: "prod-1", reason: "wrong_producer" },
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.event_type).toBe("pickup_attempt_invalid");
    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.reason).toBe("wrong_producer");
  });

  it("metadata par défaut = {} si non fournie", async () => {
    await logPickupEvent({
      eventType: "pickup_preview_ok",
      userId: "user-prod-1",
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.metadata).toEqual({});
  });

  it("userId null accepté (events orphelins)", async () => {
    await logPickupEvent({
      eventType: "pickup_attempt_rate_limited",
      userId: null,
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.user_id).toBeNull();
  });
});

describe("logPickupEvent — fail-safe", () => {
  it("DB error → swallow + console.warn (jamais throw)", async () => {
    insertSpy = vi
      .fn()
      .mockResolvedValue({
        error: { message: "audit table down" },
      }) as unknown as InsertSpy;
    await expect(
      logPickupEvent({
        eventType: "pickup_validated",
        userId: "user-prod-1",
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
    const { logPickupEvent: log } = await import(
      "@/lib/audit-logs/log-pickup-event"
    );
    await expect(
      log({ eventType: "pickup_preview_ok", userId: "u1" }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("PICKUP_EVENT_TYPES — exhaustivité 5 events", () => {
  it("contient les 5 events du cluster pickup", () => {
    expect(PICKUP_EVENT_TYPES).toEqual([
      "pickup_preview_ok",
      "pickup_preview_invalid",
      "pickup_validated",
      "pickup_attempt_invalid",
      "pickup_attempt_rate_limited",
    ]);
  });
});

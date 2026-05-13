import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests log-refund-incidents-event — pattern aligné log-pickup-event.test
// (capture insert + assertions + fail-safe). Cluster créé pour PR3
// feature/admin-new-surfaces (gap AUDIT_ADMIN.md §6 P0 #3).

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
  logRefundIncidentsEvent,
  REFUND_INCIDENTS_EVENT_TYPES,
} from "@/lib/audit-logs/log-refund-incidents-event";

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

describe("logRefundIncidentsEvent — contrat insert", () => {
  it("insère refund_incident_resolved_manually avec metadata complète", async () => {
    await logRefundIncidentsEvent({
      eventType: "refund_incident_resolved_manually",
      userId: "admin-1",
      metadata: {
        incident_id: "incident-uuid-1",
        order_id: "order-uuid-1",
        order_code: "TRR-ABC123",
        amount_cents: 4250,
        previous_status: "retrying",
        note: "Virement bancaire effectué hors-Stripe le 13/05/2026",
      },
    });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith("audit_logs", {
      user_id: "admin-1",
      event_type: "refund_incident_resolved_manually",
      metadata: {
        incident_id: "incident-uuid-1",
        order_id: "order-uuid-1",
        order_code: "TRR-ABC123",
        amount_cents: 4250,
        previous_status: "retrying",
        note: "Virement bancaire effectué hors-Stripe le 13/05/2026",
      },
    });
  });

  it("metadata par défaut = {} si non fournie", async () => {
    await logRefundIncidentsEvent({
      eventType: "refund_incident_resolved_manually",
      userId: "admin-1",
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.metadata).toEqual({});
  });

  it("userId null accepté", async () => {
    await logRefundIncidentsEvent({
      eventType: "refund_incident_resolved_manually",
      userId: null,
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.user_id).toBeNull();
  });
});

describe("logRefundIncidentsEvent — fail-safe", () => {
  it("DB error → swallow + console.warn (jamais throw)", async () => {
    insertSpy = vi.fn().mockResolvedValue({
      error: { message: "audit table down" },
    }) as unknown as InsertSpy;
    await expect(
      logRefundIncidentsEvent({
        eventType: "refund_incident_resolved_manually",
        userId: "admin-1",
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
    const { logRefundIncidentsEvent: log } = await import(
      "@/lib/audit-logs/log-refund-incidents-event"
    );
    await expect(
      log({
        eventType: "refund_incident_resolved_manually",
        userId: "admin-1",
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("REFUND_INCIDENTS_EVENT_TYPES — exhaustivité", () => {
  it("contient l'unique event du cluster refund-incidents", () => {
    expect(REFUND_INCIDENTS_EVENT_TYPES).toEqual([
      "refund_incident_resolved_manually",
    ]);
  });
});

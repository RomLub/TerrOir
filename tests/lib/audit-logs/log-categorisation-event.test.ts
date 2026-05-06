import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests log-categorisation-event — pattern aligné log-payment-event.test
// et log-auth-event.test (capture insert + assertions).

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
  logCategorisationEvent,
  CATEGORISATION_EVENT_TYPES,
} from "@/lib/audit-logs/log-categorisation-event";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  insertSpy = vi.fn().mockResolvedValue({ error: null }) as unknown as InsertSpy;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logCategorisationEvent — contrat insert", () => {
  it("insère un event admin_category_created avec metadata complète", async () => {
    await logCategorisationEvent({
      eventType: "admin_category_created",
      userId: "admin-1",
      metadata: { id: "cat-1", slug: "fruits", name: "Fruits", sort_order: 25 },
    });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith("audit_logs", {
      user_id: "admin-1",
      event_type: "admin_category_created",
      metadata: { id: "cat-1", slug: "fruits", name: "Fruits", sort_order: 25 },
    });
  });

  it("insère un event admin_animal_updated avec before/after dans metadata", async () => {
    await logCategorisationEvent({
      eventType: "admin_animal_updated",
      userId: "admin-1",
      metadata: {
        id: "a-1",
        before: { slug: "boeuf", name: "Bœuf", sort_order: 10 },
        after: { slug: "boeuf", name: "Bœuf F1", sort_order: 10 },
      },
    });
    expect(insertSpy).toHaveBeenCalledOnce();
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.event_type).toBe("admin_animal_updated");
    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.before).toEqual({ slug: "boeuf", name: "Bœuf", sort_order: 10 });
  });

  it("metadata par défaut = {} si non fournie", async () => {
    await logCategorisationEvent({
      eventType: "admin_cut_deleted",
      userId: "admin-1",
    });
    const payload = insertSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.metadata).toEqual({});
  });
});

describe("logCategorisationEvent — fail-safe", () => {
  it("DB error → swallow + console.warn (jamais throw)", async () => {
    insertSpy = vi
      .fn()
      .mockResolvedValue({ error: { message: "audit table down" } }) as unknown as InsertSpy;
    await expect(
      logCategorisationEvent({
        eventType: "admin_category_deleted",
        userId: "admin-1",
        metadata: { id: "x" },
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("createClient throw → swallow + console.warn", async () => {
    // Re-mock in this test pour faire throw createSupabaseAdminClient
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createSupabaseAdminClient: () => {
        throw new Error("env missing");
      },
    }));
    const { logCategorisationEvent: log } = await import(
      "@/lib/audit-logs/log-categorisation-event"
    );
    await expect(
      log({
        eventType: "admin_category_deleted",
        userId: "admin-1",
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("CATEGORISATION_EVENT_TYPES — exhaustivité 9 events (3×3)", () => {
  it("contient les 9 events (categories/animals/cuts × created/updated/deleted)", () => {
    expect(CATEGORISATION_EVENT_TYPES).toEqual([
      "admin_category_created",
      "admin_category_updated",
      "admin_category_deleted",
      "admin_animal_created",
      "admin_animal_updated",
      "admin_animal_deleted",
      "admin_cut_created",
      "admin_cut_updated",
      "admin_cut_deleted",
    ]);
  });
});

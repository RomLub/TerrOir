// Tests vitest pour lib/webhook-events/check-or-mark-processed.ts —
// dédup applicative webhooks Stripe via INSERT exclusif PK event_id (T-103).
//
// Stratégie : mock SupabaseClient injecté via argument (pattern aligné
// tests/lib/producer-interests/upsert-interest.test.ts). Capture l'INSERT
// et permet d'enqueuer la réponse error.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { checkOrMarkProcessed } from "@/lib/webhook-events/check-or-mark-processed";

type Resp = { error: { message?: string; code?: string } | null };

let capturedInsert: { table: string; payload: unknown } | null;
let nextResp: Resp;

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => ({
      insert: (payload: unknown) => {
        capturedInsert = { table, payload };
        return Promise.resolve(nextResp);
      },
    }),
  } as unknown as SupabaseClient;
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  capturedInsert = null;
  nextResp = { error: null };
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkOrMarkProcessed — INSERT initial (event jamais vu)", () => {
  it("succès → alreadyProcessed:false + payload INSERT correct", async () => {
    nextResp = { error: null };
    const client = buildMockClient();
    const res = await checkOrMarkProcessed(
      client,
      "evt_test_1",
      "payment_intent.succeeded",
    );
    expect(res.alreadyProcessed).toBe(false);
    expect(capturedInsert?.table).toBe("webhook_events_processed");
    const payload = capturedInsert?.payload as Record<string, unknown>;
    expect(payload.event_id).toBe("evt_test_1");
    expect(payload.event_type).toBe("payment_intent.succeeded");
    // processed_at non passé : géré côté DB via DEFAULT now()
    expect(payload).not.toHaveProperty("processed_at");
    // Pas de log côté happy path (silence opérationnel)
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("event_type variable bien transmis dans le payload", async () => {
    nextResp = { error: null };
    const client = buildMockClient();
    await checkOrMarkProcessed(client, "evt_test_payout", "payout.paid");
    const payload = capturedInsert?.payload as Record<string, unknown>;
    expect(payload.event_type).toBe("payout.paid");
  });
});

describe("checkOrMarkProcessed — conflit 23505 (event rejoué)", () => {
  it("SQLSTATE 23505 → alreadyProcessed:true + log [WEBHOOK_DEDUP_SKIP], pas de throw", async () => {
    nextResp = {
      error: { message: "duplicate key value", code: "23505" },
    };
    const client = buildMockClient();
    const res = await checkOrMarkProcessed(
      client,
      "evt_replayed_1",
      "payment_intent.succeeded",
    );
    expect(res.alreadyProcessed).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalled();
    const logged = String(consoleLogSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("[WEBHOOK_DEDUP_SKIP]");
    expect(logged).toContain("evt_replayed_1");
    expect(logged).toContain("payment_intent.succeeded");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

describe("checkOrMarkProcessed — erreur DB hors 23505", () => {
  it("erreur générique (ex: connection lost) → throw + log [WEBHOOK_DEDUP_INSERT_ERR]", async () => {
    nextResp = {
      error: { message: "connection lost", code: "08000" },
    };
    const client = buildMockClient();
    await expect(
      checkOrMarkProcessed(client, "evt_db_err", "account.updated"),
    ).rejects.toThrow("webhook_events_processed insert failed: connection lost");
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("[WEBHOOK_DEDUP_INSERT_ERR]");
    expect(logged).toContain("evt_db_err");
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("erreur sans code (cas dégénéré) → throw avec message 'unknown'", async () => {
    nextResp = {
      error: { message: "weird error" },
    };
    const client = buildMockClient();
    await expect(
      checkOrMarkProcessed(client, "evt_no_code", "payout.paid"),
    ).rejects.toThrow("webhook_events_processed insert failed: weird error");
  });

  it("erreur sans message → throw avec 'unknown'", async () => {
    nextResp = {
      error: { code: "99999" },
    };
    const client = buildMockClient();
    await expect(
      checkOrMarkProcessed(client, "evt_no_msg", "account.updated"),
    ).rejects.toThrow("webhook_events_processed insert failed: unknown");
  });
});

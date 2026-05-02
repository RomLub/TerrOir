import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// T-102.2.c — refonte tests cohérent nouvelle source-of-truth refund_incidents.
// L'ancien fichier testait buildRetryTargets (pure function audit_logs-driven)
// + intégration cron. Le nouveau cron query refund_incidents directement et
// délègue à retryIncident → tests unitaires mockés, cohérents avec T-102.2.b.

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/refund-incidents/retry-incident", () => ({
  retryIncident: vi.fn(),
}));

import { POST } from "@/app/api/cron/retry-failed-refunds/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { retryIncident } from "@/lib/refund-incidents/retry-incident";

// Mock builder pour la chaîne :
//   admin.from("refund_incidents").select(...).in(...).order(...).limit(...) → thenable
type ChainResp = { data?: unknown; error?: unknown };

function makeSupabase(resp: ChainResp): SupabaseClient {
  const builder: Record<string, unknown> = {};
  builder.select = (_cols: string) => builder;
  builder.in = (_col: string, _vals: unknown) => builder;
  builder.order = (_col: string, _opts: unknown) => builder;
  builder.limit = (_n: number) => builder;
  builder.then = (onFulfilled: (r: ChainResp) => unknown) => onFulfilled(resp);
  return {
    from: (_table: string) => builder,
  } as unknown as SupabaseClient;
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
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(retryIncident).mockReset();
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
// A. Auth
// =============================================================================

describe("POST /api/cron/retry-failed-refunds — auth", () => {
  it("401 quand authorization header missing", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({ data: [], error: null }),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(retryIncident).not.toHaveBeenCalled();
  });

  it("401 quand authorization header ne match pas Bearer <CRON_SECRET>", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({ data: [], error: null }),
    );
    const res = await POST(makeRequest({ auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(retryIncident).not.toHaveBeenCalled();
  });
});

// =============================================================================
// B. Query refund_incidents
// =============================================================================

describe("POST /api/cron/retry-failed-refunds — query refund_incidents", () => {
  it("SELECT retourne 0 incidents → {processed:0, results:[]}", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({ data: [], error: null }),
    );
    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 0, results: [] });
    expect(retryIncident).not.toHaveBeenCalled();
  });

  it("SELECT retourne PostgREST error → 500 avec message", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({ data: null, error: { message: "table down" } }),
    );
    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("table down");
    expect(retryIncident).not.toHaveBeenCalled();
  });

  it("filtre JS retry_count < max_retries — incident avec retry_count >= max_retries skip", async () => {
    // Incident A : retry_count=0 < max_retries=3 → eligible
    // Incident B : retry_count=3 == max_retries=3 → skip (defensive, ne devrait
    //   pas arriver vu que la RPC pose status='exhausted' à 3, mais filtre
    //   défensif côté JS).
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({
        data: [
          {
            id: "inc-A",
            order_id: "order-A",
            kind: "admin",
            payment_intent_id: "pi_A",
            consumer_id: "user-A",
            blocked_reason: null,
            retry_count: 0,
            max_retries: 3,
          },
          {
            id: "inc-B",
            order_id: "order-B",
            kind: "admin",
            payment_intent_id: "pi_B",
            consumer_id: "user-B",
            blocked_reason: null,
            retry_count: 3,
            max_retries: 3,
          },
        ],
        error: null,
      }),
    );
    vi.mocked(retryIncident).mockResolvedValue("succeeded");

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(retryIncident).toHaveBeenCalledTimes(1);
    expect(retryIncident).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: "inc-A" }),
    );
  });
});

// =============================================================================
// C. Boucle séquentielle retry
// =============================================================================

describe("POST /api/cron/retry-failed-refunds — boucle séquentielle", () => {
  it("3 incidents éligibles → retryIncident appelé 3× avec params corrects + résultats agrégés", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({
        data: [
          {
            id: "inc-1",
            order_id: "order-1",
            kind: "admin",
            payment_intent_id: "pi_1",
            consumer_id: "user-1",
            blocked_reason: null,
            retry_count: 0,
            max_retries: 3,
          },
          {
            id: "inc-2",
            order_id: "order-2",
            kind: "revival",
            payment_intent_id: "pi_2",
            consumer_id: "user-2",
            blocked_reason: "blocked_stock",
            retry_count: 1,
            max_retries: 3,
          },
          {
            id: "inc-3",
            order_id: "order-3",
            kind: "timeout",
            payment_intent_id: "pi_3",
            consumer_id: null,
            blocked_reason: null,
            retry_count: 2,
            max_retries: 3,
          },
        ],
        error: null,
      }),
    );
    vi.mocked(retryIncident)
      .mockResolvedValueOnce("succeeded")
      .mockResolvedValueOnce("failed_will_retry")
      .mockResolvedValueOnce("failed_exhausted");

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    expect(retryIncident).toHaveBeenCalledTimes(3);
    expect(retryIncident).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        incidentId: "inc-1",
        kind: "admin",
        blockedReason: null,
        retryCount: 0,
      }),
    );
    expect(retryIncident).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        incidentId: "inc-2",
        kind: "revival",
        blockedReason: "blocked_stock",
        retryCount: 1,
      }),
    );
    expect(retryIncident).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        incidentId: "inc-3",
        kind: "timeout",
        consumerId: null,
        retryCount: 2,
      }),
    );

    expect(body.processed).toBe(3);
    expect(body.results).toEqual([
      {
        incident_id: "inc-1",
        order_id: "order-1",
        kind: "admin",
        result: "succeeded",
      },
      {
        incident_id: "inc-2",
        order_id: "order-2",
        kind: "revival",
        result: "failed_will_retry",
      },
      {
        incident_id: "inc-3",
        order_id: "order-3",
        kind: "timeout",
        result: "failed_exhausted",
      },
    ]);
  });

  it("retryIncident throw sur 1 incident → autres traités quand même + log [REFUND_RETRY_HELPER_CRASH]", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({
        data: [
          {
            id: "inc-OK",
            order_id: "order-OK",
            kind: "admin",
            payment_intent_id: "pi_ok",
            consumer_id: "u1",
            blocked_reason: null,
            retry_count: 0,
            max_retries: 3,
          },
          {
            id: "inc-CRASH",
            order_id: "order-CRASH",
            kind: "admin",
            payment_intent_id: "pi_crash",
            consumer_id: "u2",
            blocked_reason: null,
            retry_count: 0,
            max_retries: 3,
          },
          {
            id: "inc-AFTER",
            order_id: "order-AFTER",
            kind: "timeout",
            payment_intent_id: "pi_after",
            consumer_id: "u3",
            blocked_reason: null,
            retry_count: 1,
            max_retries: 3,
          },
        ],
        error: null,
      }),
    );
    vi.mocked(retryIncident)
      .mockResolvedValueOnce("succeeded")
      .mockRejectedValueOnce(new Error("unexpected helper crash"))
      .mockResolvedValueOnce("failed_will_retry");

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      results: Array<Record<string, unknown>>;
    };

    expect(retryIncident).toHaveBeenCalledTimes(3);
    expect(body.processed).toBe(3);
    // Le crash devient 'failed_will_retry' par fallback défensif.
    expect(body.results[1]).toEqual({
      incident_id: "inc-CRASH",
      order_id: "order-CRASH",
      kind: "admin",
      result: "failed_will_retry",
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_HELPER_CRASH]",
    );
  });
});

// =============================================================================
// D. Defensive — kind/blocked_reason invalides
// =============================================================================

describe("POST /api/cron/retry-failed-refunds — defensive bad data", () => {
  it("kind invalide (corrupt DB) → skip + warn [REFUND_RETRY_SKIP_BAD_KIND], n'appelle pas retryIncident", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({
        data: [
          {
            id: "inc-bad",
            order_id: "order-bad",
            kind: "bogus_kind",
            payment_intent_id: "pi_bad",
            consumer_id: "u1",
            blocked_reason: null,
            retry_count: 0,
            max_retries: 3,
          },
        ],
        error: null,
      }),
    );

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(retryIncident).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_SKIP_BAD_KIND]",
    );
  });

  it("kind='revival' avec blocked_reason null → skip + warn [REFUND_RETRY_SKIP_BAD_BLOCKED]", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({
        data: [
          {
            id: "inc-rev-no-blocked",
            order_id: "order-x",
            kind: "revival",
            payment_intent_id: "pi_x",
            consumer_id: "u1",
            blocked_reason: null,
            retry_count: 0,
            max_retries: 3,
          },
        ],
        error: null,
      }),
    );

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(retryIncident).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleWarnSpy.mock.calls[0]?.[0])).toContain(
      "[REFUND_RETRY_SKIP_BAD_BLOCKED]",
    );
  });

  it("kind='admin' avec blocked_reason non-null (cohérent T-102.2.b: null sur admin/timeout) → blockedReason ignoré (null passé au helper)", async () => {
    // Cohérent avec T-102.2.b qui pose blocked_reason=null pour admin/timeout.
    // Si une row corrompue avait par hasard une valeur non-null, on la
    // n'utilise PAS pour kind=admin (qui ne consomme jamais blockedReason
    // côté retry-incident.ts).
    vi.mocked(createSupabaseAdminClient).mockReturnValue(
      makeSupabase({
        data: [
          {
            id: "inc-admin-weird",
            order_id: "order-x",
            kind: "admin",
            payment_intent_id: "pi_x",
            consumer_id: "u1",
            blocked_reason: "blocked_stock", // anormal pour admin mais non-bloquant
            retry_count: 0,
            max_retries: 3,
          },
        ],
        error: null,
      }),
    );
    vi.mocked(retryIncident).mockResolvedValue("succeeded");

    const res = await POST(makeRequest({ auth: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    expect(retryIncident).toHaveBeenCalledTimes(1);
    expect(retryIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "admin",
        blockedReason: "blocked_stock",
      }),
    );
  });
});

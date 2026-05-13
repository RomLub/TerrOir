import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAdminRefundIncidentDetail,
  fetchAdminRefundIncidentAttempts,
  fetchAdminRefundIncidentsList,
} from "@/lib/admin/refund-incidents/fetch";

// Tests fetch helpers /refund-incidents (PR3 feature/admin-new-surfaces).
// Mock chain builder Supabase (in/eq/order/limit + then) cohérent pattern
// PR1 lib/admin/producers/fetch.test (équivalent).

type BuilderResp = { data?: unknown; error?: unknown; count?: number };

// Builder Supabase mocké : tous les filter methods retournent le builder
// pour chaining, le `then` final résout sur la réponse seedée.
function makeBuilder(resp: BuilderResp) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: resp.data, error: resp.error ?? null }),
  );
  builder.then = (
    onFulfilled: (r: BuilderResp) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) =>
    Promise.resolve({
      data: resp.data,
      error: resp.error ?? null,
      count: resp.count,
    }).then(onFulfilled, onRejected);
  return builder;
}

// Mock admin client avec FIFO par table : chaque `.from(table)` consomme
// la prochaine réponse seedée.
function makeAdmin(responses: Record<string, BuilderResp[]>): SupabaseClient {
  return {
    from: (table: string) => {
      const r = responses[table]?.shift() ?? { data: null, error: null };
      return makeBuilder(r);
    },
  } as unknown as SupabaseClient;
}

describe("fetchAdminRefundIncidentsList", () => {
  const NULL_CURSOR = { before: null, beforeId: null };

  it("happy path : map les rows DB + jointure orders → AdminRefundIncidentRow", async () => {
    const admin = makeAdmin({
      refund_incidents: [
        {
          data: [
            {
              id: "inc-1",
              order_id: "ord-1",
              kind: "admin",
              status: "pending",
              retry_count: 1,
              max_retries: 3,
              last_error_code: "card_declined",
              last_error_message: "Your card was declined",
              first_failed_event_at: "2026-05-10T10:00:00Z",
              created_at: "2026-05-10T10:00:00Z",
              resolved_at: null,
              order: { code_commande: "TRR-ABC", montant_total: "42.50" },
            },
          ],
        },
        // 2e from() pour le count
        { count: 1 },
      ],
    });

    const res = await fetchAdminRefundIncidentsList(admin, {
      cursor: NULL_CURSOR,
      statusFilter: "pending",
    });

    expect(res.error).toBeNull();
    expect(res.total).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "inc-1",
      orderCode: "TRR-ABC",
      amountCents: 4250,
      kind: "admin",
      status: "pending",
      retryCount: 1,
      maxRetries: 3,
      lastErrorCode: "card_declined",
    });
  });

  it("jointure orders en array (compat ancienne version client) → normalisée", async () => {
    const admin = makeAdmin({
      refund_incidents: [
        {
          data: [
            {
              id: "inc-2",
              order_id: "ord-2",
              kind: "revival",
              status: "retrying",
              retry_count: 2,
              max_retries: 3,
              last_error_code: null,
              last_error_message: null,
              first_failed_event_at: "2026-05-10T10:00:00Z",
              created_at: "2026-05-10T10:00:00Z",
              resolved_at: null,
              order: [{ code_commande: "TRR-XYZ", montant_total: 12.99 }],
            },
          ],
        },
        { count: 1 },
      ],
    });

    const res = await fetchAdminRefundIncidentsList(admin, {
      cursor: NULL_CURSOR,
      statusFilter: "retrying",
    });
    expect(res.rows[0]?.orderCode).toBe("TRR-XYZ");
    expect(res.rows[0]?.amountCents).toBe(1299);
  });

  it("montant null → amountCents = 0 (pas de crash)", async () => {
    const admin = makeAdmin({
      refund_incidents: [
        {
          data: [
            {
              id: "inc-3",
              order_id: "ord-3",
              kind: "timeout",
              status: "exhausted",
              retry_count: 3,
              max_retries: 3,
              last_error_code: null,
              last_error_message: null,
              first_failed_event_at: "2026-05-10T10:00:00Z",
              created_at: "2026-05-10T10:00:00Z",
              resolved_at: null,
              order: { code_commande: null, montant_total: null },
            },
          ],
        },
        { count: 1 },
      ],
    });

    const res = await fetchAdminRefundIncidentsList(admin, {
      cursor: NULL_CURSOR,
      statusFilter: "failed",
    });
    expect(res.rows[0]?.amountCents).toBe(0);
    expect(res.rows[0]?.orderCode).toBeNull();
  });

  it("DB error sur items → result.error message + rows vide", async () => {
    const admin = makeAdmin({
      refund_incidents: [
        { error: { message: "permission denied" } },
        { count: 0 },
      ],
    });

    const res = await fetchAdminRefundIncidentsList(admin, {
      cursor: NULL_CURSOR,
      statusFilter: "all",
    });
    expect(res.error).toBe("permission denied");
    expect(res.rows).toEqual([]);
  });

  it("DB error sur count → result.error message + rows vide", async () => {
    const admin = makeAdmin({
      refund_incidents: [
        { data: [] },
        { error: { message: "count failed" } },
      ],
    });

    const res = await fetchAdminRefundIncidentsList(admin, {
      cursor: NULL_CURSOR,
      statusFilter: "all",
    });
    expect(res.error).toBe("count failed");
  });
});

describe("fetchAdminRefundIncidentDetail", () => {
  it("happy path : retourne le détail aplati avec jointure orders", async () => {
    const admin = makeAdmin({
      refund_incidents: [
        {
          data: {
            id: "inc-1",
            order_id: "ord-1",
            payment_intent_id: "pi_123",
            consumer_id: "user-1",
            kind: "admin",
            status: "pending",
            retry_count: 1,
            max_retries: 3,
            last_error_code: "card_declined",
            last_error_message: "Your card was declined",
            blocked_reason: null,
            resolution_note: null,
            first_failed_event_at: "2026-05-10T10:00:00Z",
            resolved_at: null,
            created_at: "2026-05-10T10:00:00Z",
            updated_at: "2026-05-10T10:05:00Z",
            order: { code_commande: "TRR-DEF", montant_total: "100.00" },
          },
        },
      ],
    });

    const res = await fetchAdminRefundIncidentDetail(admin, "inc-1");
    expect(res.error).toBeNull();
    expect(res.incident).toMatchObject({
      id: "inc-1",
      orderCode: "TRR-DEF",
      amountCents: 10000,
      paymentIntentId: "pi_123",
      consumerId: "user-1",
      status: "pending",
    });
  });

  it("introuvable → incident null + error null (404 côté call site)", async () => {
    const admin = makeAdmin({
      refund_incidents: [{ data: null }],
    });
    const res = await fetchAdminRefundIncidentDetail(admin, "inc-unknown");
    expect(res.incident).toBeNull();
    expect(res.error).toBeNull();
  });

  it("DB error → incident null + error message", async () => {
    const admin = makeAdmin({
      refund_incidents: [{ error: { message: "db down" } }],
    });
    const res = await fetchAdminRefundIncidentDetail(admin, "inc-x");
    expect(res.incident).toBeNull();
    expect(res.error).toBe("db down");
  });
});

describe("fetchAdminRefundIncidentAttempts", () => {
  it("happy path : retourne les attempts triées chronologiquement", async () => {
    const admin = makeAdmin({
      refund_incident_attempts: [
        {
          data: [
            {
              id: "att-1",
              attempt_number: 1,
              outcome: "failed",
              stripe_error_code: "card_declined",
              stripe_error_type: "card_error",
              stripe_error_message: "Card declined",
              stripe_request_id: "req_1",
              stripe_refund_id: null,
              attempted_at: "2026-05-10T10:00:00Z",
            },
            {
              id: "att-2",
              attempt_number: 2,
              outcome: "failed",
              stripe_error_code: null,
              stripe_error_type: null,
              stripe_error_message: null,
              stripe_request_id: "req_2",
              stripe_refund_id: null,
              attempted_at: "2026-05-10T10:05:00Z",
            },
          ],
        },
      ],
    });

    const res = await fetchAdminRefundIncidentAttempts(admin, "inc-1");
    expect(res.error).toBeNull();
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0]?.attemptNumber).toBe(1);
    expect(res.attempts[0]?.stripeErrorCode).toBe("card_declined");
  });

  it("aucune tentative → tableau vide + error null", async () => {
    const admin = makeAdmin({
      refund_incident_attempts: [{ data: [] }],
    });
    const res = await fetchAdminRefundIncidentAttempts(admin, "inc-1");
    expect(res.attempts).toEqual([]);
    expect(res.error).toBeNull();
  });

  it("DB error → attempts vide + error message", async () => {
    const admin = makeAdmin({
      refund_incident_attempts: [{ error: { message: "select failed" } }],
    });
    const res = await fetchAdminRefundIncidentAttempts(admin, "inc-1");
    expect(res.attempts).toEqual([]);
    expect(res.error).toBe("select failed");
  });
});

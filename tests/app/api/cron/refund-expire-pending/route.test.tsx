// F-014 v2 (audit P0 sweep 2026-05-11) — Tests vitest cron J+7 expire.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL = "admin@terroir-local.fr";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_ADMIN_URL = "http://localhost:3002";
  process.env.CRON_SECRET = "test-cron-secret";
});

const { mockLogPaymentEvent, mockSendTemplate } = vi.hoisted(() => ({
  mockLogPaymentEvent: vi.fn(),
  mockSendTemplate: vi.fn(),
}));

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: mockLogPaymentEvent,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

vi.mock("@/lib/resend/templates/producer-refund-pending-decision", () => ({
  default: () => null,
  subject: (p: { decision: string }) => `decision-${p.decision}`,
}));

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "pending";

let captured: {
  fromCalls: string[];
  updates: Array<{ table: string; payload: unknown }>;
};
let responses: Record<string, Partial<Record<"select" | "update", Resp[]>>>;

function consume(table: string, op: Op): Resp {
  if (op === "pending") return { data: null, error: null };
  const queue = responses[table]?.[op as "select" | "update"];
  if (queue && queue.length > 0) return queue.shift()!;
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (_cols: string) => {
        if (builder._op === "pending") builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.eq = () => builder;
      builder.lt = () => builder;
      builder.limit = () => builder;
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.single = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  }),
}));

import { POST } from "@/app/api/cron/refund-expire-pending/route";

beforeEach(() => {
  captured = { fromCalls: [], updates: [] };
  responses = {};
  mockLogPaymentEvent.mockReset().mockResolvedValue(undefined);
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "e1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function authedRequest(): Request {
  return {
    headers: new Headers({ authorization: "Bearer test-cron-secret" }),
  } as unknown as Request;
}

describe("F-014 v2 cron refund-expire-pending", () => {
  it("aucun pending > 7j → ok, expired=0, pas d'UPDATE", async () => {
    responses.pending_refunds = { select: [{ data: [], error: null }] };
    const res = await POST(authedRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, expired: 0 });
    expect(captured.updates).toEqual([]);
  });

  it("auth: missing Bearer → 401", async () => {
    const res = await POST({
      headers: new Headers(),
    } as unknown as Request);
    expect(res.status).toBe(401);
  });

  it("1 pending > 7j → UPDATE status=expired + audit log + 2 emails (producer + admin)", async () => {
    responses.pending_refunds = {
      select: [
        {
          data: [
            {
              id: "pend-1",
              order_id: "order-1",
              producer_id: "prod-1",
              amount_eur: 750,
              reason: null,
              requested_at: "2025-11-01T00:00:00Z",
              order: { code_commande: "ABC123" },
              producer: { user_id: "user-prod-1" },
            },
          ],
          error: null,
        },
      ],
      update: [{ data: { id: "pend-1" }, error: null }],
    };
    responses.users = {
      select: [{ data: { email: "prod@example.com" }, error: null }],
    };

    const res = await POST(authedRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, expired: 1, errors: 0 });
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]?.payload).toMatchObject({
      status: "expired",
    });
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "producer_refund_pending_expired",
        metadata: expect.objectContaining({ pending_refund_id: "pend-1" }),
      }),
    );
    // 2 emails : producer + admin
    expect(mockSendTemplate).toHaveBeenCalledTimes(2);
  });

  it("race UPDATE WHERE status=pending miss (admin a tranché entre fetch et update) → skip + count erreurs=0", async () => {
    responses.pending_refunds = {
      select: [
        {
          data: [
            {
              id: "pend-2",
              order_id: "order-2",
              producer_id: "prod-2",
              amount_eur: 600,
              reason: null,
              requested_at: "2025-11-01T00:00:00Z",
              order: null,
              producer: { user_id: "user-prod-2" },
            },
          ],
          error: null,
        },
      ],
      update: [{ data: null, error: null }],
    };
    const res = await POST(authedRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, expired: 0, errors: 0 });
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

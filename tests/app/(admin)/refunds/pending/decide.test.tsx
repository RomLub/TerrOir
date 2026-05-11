// F-014 v2 (audit P0 sweep 2026-05-11) — Tests vitest pour les server
// actions approvePendingRefund / denyPendingRefund. Couverture :
//   1. approve happy path → UPDATE pending + executeRefundFlow + audit log
//      + email producer.
//   2. deny → UPDATE pending + audit log + email producer (pas de Stripe).
//   3. double-approve idempotent → UPDATE WHERE status='pending' miss →
//      already_decided.
//   4. forbidden si !isAdmin.
//   5. invalid input (uuid invalide).
//   6. executeRefundFlow erreur → server action retourne execute_failed:*.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_ADMIN_URL = "http://localhost:3002";
});

const {
  mockGetSessionUser,
  mockLogPaymentEvent,
  mockSendTemplate,
  mockExecuteRefundFlow,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
  mockLogPaymentEvent: vi.fn(),
  mockSendTemplate: vi.fn(),
  mockExecuteRefundFlow: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mockGetSessionUser,
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

vi.mock("@/lib/refunds/execute-refund", () => ({
  executeRefundFlow: mockExecuteRefundFlow,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => p,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

let captured: {
  updates: Array<{ table: string; payload: unknown }>;
  selects: Array<{ table: string; cols: string }>;
};
let responses: Record<string, Partial<Record<"select" | "update", Resp[]>>>;

const PENDING_ID = "ee111111-1111-4111-8111-111111111111";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCER_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCER_USER_ID = "33333333-3333-4333-8333-333333333333";

function consume(table: string, op: Op): Resp {
  if (op === "pending") return { data: null, error: null };
  const queue = responses[table]?.[op as "select" | "update"];
  if (queue && queue.length > 0) return queue.shift()!;
  if (op === "update") return { data: null, error: null };
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        if (builder._op === "pending") builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.eq = () => builder;
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.single = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  }),
}));

import {
  approvePendingRefund,
  denyPendingRefund,
} from "@/app/(admin)/refunds/pending/_actions/decide";

beforeEach(() => {
  captured = { updates: [], selects: [] };
  responses = {};
  mockGetSessionUser.mockReset().mockResolvedValue({
    id: "admin-user-1",
    isAdmin: true,
    email: "admin@example.com",
    roles: [],
  });
  mockLogPaymentEvent.mockReset().mockResolvedValue(undefined);
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "email_id" });
  mockExecuteRefundFlow
    .mockReset()
    .mockResolvedValue({ kind: "success", refundId: "re_test_abc" });
  mockRevalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function pushPendingUpdate(row: object | null) {
  responses.pending_refunds = responses.pending_refunds ?? {};
  responses.pending_refunds.update = [
    ...(responses.pending_refunds.update ?? []),
    { data: row, error: null },
  ];
}

function pushOrderLookup(order: object | null) {
  responses.orders = responses.orders ?? {};
  responses.orders.select = [
    ...(responses.orders.select ?? []),
    { data: order, error: null },
  ];
}

function pushProducerLookup(producer: object | null) {
  responses.producers = responses.producers ?? {};
  responses.producers.select = [
    ...(responses.producers.select ?? []),
    { data: producer, error: null },
  ];
}

function pushUserLookup(user: object | null) {
  responses.users = responses.users ?? {};
  responses.users.select = [
    ...(responses.users.select ?? []),
    { data: user, error: null },
  ];
}

function makeForm(pendingId: string, reason?: string): FormData {
  const fd = new FormData();
  fd.set("pendingRefundId", pendingId);
  if (reason) fd.set("decisionReason", reason);
  return fd;
}

describe("approvePendingRefund — happy path", () => {
  it("approve → UPDATE pending + executeRefundFlow + audit log + email producer", async () => {
    pushPendingUpdate({
      id: PENDING_ID,
      order_id: ORDER_ID,
      producer_id: PRODUCER_ID,
      amount_eur: 750,
      reason: null,
    });
    pushOrderLookup({
      id: ORDER_ID,
      consumer_id: "cons-1",
      producer_id: PRODUCER_ID,
      statut: "pending",
      stripe_payment_intent_id: "pi_x",
      montant_total: 750,
      code_commande: "ABC123",
    });
    pushProducerLookup({
      user_id: PRODUCER_USER_ID,
      nom_exploitation: "Ferme Test",
    });
    pushUserLookup({ email: "prod@example.com" });
    pushOrderLookup({ code_commande: "ABC123" });

    const res = await approvePendingRefund(makeForm(PENDING_ID, "OK légitime"));

    expect(res).toEqual({
      ok: true,
      decision: "approved",
      refundId: "re_test_abc",
    });
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]).toMatchObject({
      table: "pending_refunds",
      payload: expect.objectContaining({
        status: "approved",
        decided_by: "admin-user-1",
        decision_reason: "OK légitime",
      }),
    });
    expect(mockExecuteRefundFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        emittedBy: "admin_approved_pending",
        idempotencyKey: `pending_refund_${PENDING_ID}`,
      }),
    );
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "producer_refund_admin_approved",
        metadata: expect.objectContaining({
          pending_refund_id: PENDING_ID,
          order_id: ORDER_ID,
        }),
      }),
    );
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "prod@example.com",
        template: "producer_refund_pending_decision",
      }),
    );
  });
});

describe("denyPendingRefund — flow nominal", () => {
  it("deny → UPDATE pending + audit log + email producer, AUCUN refund Stripe", async () => {
    pushPendingUpdate({
      id: PENDING_ID,
      order_id: ORDER_ID,
      producer_id: PRODUCER_ID,
      amount_eur: 750,
      reason: null,
    });
    pushProducerLookup({
      user_id: PRODUCER_USER_ID,
      nom_exploitation: "Ferme Test",
    });
    pushUserLookup({ email: "prod@example.com" });
    pushOrderLookup({ code_commande: "ABC123" });

    const res = await denyPendingRefund(makeForm(PENDING_ID, "Motif insuffisant"));

    expect(res).toEqual({ ok: true, decision: "denied" });
    expect(mockExecuteRefundFlow).not.toHaveBeenCalled();
    expect(captured.updates[0]?.payload).toMatchObject({
      status: "denied",
      decision_reason: "Motif insuffisant",
    });
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "producer_refund_admin_denied" }),
    );
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "prod@example.com",
        template: "producer_refund_pending_decision",
      }),
    );
  });
});

describe("idempotence (double-approve)", () => {
  it("approve sur pending déjà décidé → UPDATE renvoie null → already_decided", async () => {
    pushPendingUpdate(null);
    const res = await approvePendingRefund(makeForm(PENDING_ID));
    expect(res).toEqual({ ok: false, reason: "already_decided" });
    expect(mockExecuteRefundFlow).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

describe("forbidden (non-admin)", () => {
  it("session non-admin → forbidden, aucun UPDATE", async () => {
    mockGetSessionUser.mockResolvedValueOnce({
      id: "user-x",
      isAdmin: false,
      email: "x@example.com",
      roles: ["producer"],
    });
    const res = await approvePendingRefund(makeForm(PENDING_ID));
    expect(res).toEqual({ ok: false, reason: "forbidden" });
    expect(captured.updates).toEqual([]);
  });
});

describe("invalid input", () => {
  it("pendingRefundId non-uuid → invalid_input", async () => {
    const fd = new FormData();
    fd.set("pendingRefundId", "not-a-uuid");
    const res = await approvePendingRefund(fd);
    expect(res).toEqual({ ok: false, reason: "invalid_input" });
  });
});

describe("executeRefundFlow erreur → execute_failed propagé", () => {
  it("kind='stripe_failed' → ok:false reason:execute_failed:stripe_failed (mais UPDATE et audit logué)", async () => {
    pushPendingUpdate({
      id: PENDING_ID,
      order_id: ORDER_ID,
      producer_id: PRODUCER_ID,
      amount_eur: 750,
      reason: null,
    });
    pushOrderLookup({
      id: ORDER_ID,
      consumer_id: "cons-1",
      producer_id: PRODUCER_ID,
      statut: "pending",
      stripe_payment_intent_id: "pi_x",
      montant_total: 750,
      code_commande: "ABC123",
    });
    pushProducerLookup({ user_id: PRODUCER_USER_ID });
    pushUserLookup({ email: "prod@example.com" });
    pushOrderLookup({ code_commande: "ABC123" });
    mockExecuteRefundFlow.mockResolvedValueOnce({
      kind: "stripe_failed",
      error: new Error("stripe boom"),
    });

    const res = await approvePendingRefund(makeForm(PENDING_ID));
    expect(res).toEqual({
      ok: false,
      reason: "execute_failed:stripe_failed",
    });
    expect(captured.updates).toHaveLength(1);
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "producer_refund_admin_approved" }),
    );
  });
});

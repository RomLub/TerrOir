// Test unitaire helper sendOpsAlert (Cluster B Phase 3 bugs-P1-3).
//
// Verifie 4 contrats critiques :
//   1. Strip PII : email/phone/lat/lng/cp/consumer_id/payment_intent_id
//      strippes du metadata avant Sentry + email body.
//   2. producer_id autorise (signal diagnostic ops backend pure).
//   3. Sentry.captureException appele avec tags + extra.
//   4. sendTemplate appele avec sujet "[OPS] {prefix} {summary}".
//   5. Fail-safe : helper ne throw JAMAIS (Sentry throw + email throw OK).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SUPPORT_EMAIL =
    process.env.SUPPORT_EMAIL ?? "admin@terroir-test.fr";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

const { mockCaptureException, mockSendTemplate } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
  mockSendTemplate: vi.fn(async () => ({ ok: true, id: "resend_test" })),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureException,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

import { sendOpsAlert } from "@/lib/ops/alert";

describe("sendOpsAlert (Cluster B Phase 3)", () => {
  beforeEach(() => {
    mockCaptureException.mockClear();
    mockSendTemplate.mockClear();
  });

  it("strip PII keys du metadata avant Sentry capture", async () => {
    const err = new Error("test error");
    await sendOpsAlert("[REFUND_DB_DRIFT]", err, {
      order_id: "ord-1",
      producer_id: "prod-1",
      consumer_id: "cons-1", // PII → strippe
      email: "user@x.com", // PII → strippe
      phone: "+33123", // PII → strippe
      latitude: 48.8, // PII → strippe
      longitude: 2.3, // PII → strippe
      code_postal: "72000", // PII → strippe
      payment_intent_id: "pi_xxx", // PII → strippe
      db_error: "duplicate key",
    });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [, opts] = mockCaptureException.mock.calls[0]!;
    expect(opts.extra).toEqual({
      order_id: "ord-1",
      producer_id: "prod-1", // autorise
      db_error: "duplicate key",
    });
    expect(opts.extra).not.toHaveProperty("email");
    expect(opts.extra).not.toHaveProperty("phone");
    expect(opts.extra).not.toHaveProperty("latitude");
    expect(opts.extra).not.toHaveProperty("longitude");
    expect(opts.extra).not.toHaveProperty("consumer_id");
    expect(opts.extra).not.toHaveProperty("code_postal");
    expect(opts.extra).not.toHaveProperty("payment_intent_id");
  });

  it("Sentry tags pose ops_prefix + order_id", async () => {
    await sendOpsAlert("[STRIPE_WEBHOOK_BG_ERR]", new Error("boom"), {
      order_id: "ord-42",
    });
    const [, opts] = mockCaptureException.mock.calls[0]!;
    expect(opts.tags).toMatchObject({
      ops_prefix: "[STRIPE_WEBHOOK_BG_ERR]",
      order_id: "ord-42",
    });
  });

  it("sendTemplate appele avec sujet [OPS] {prefix} {summary}", async () => {
    await sendOpsAlert("[REFUND_DB_DRIFT]", new Error("update failed"), {
      order_id: "ord-7",
    });

    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    // Cast nécessaire : vi.fn(async () => ({...})) sans signature explicite
    // type mock.calls comme [][]. Le double cast `unknown[]` puis `[0] as T`
    // récupère l'argument typé sans perdre la sécurité (vs `any`).
    const args = (mockSendTemplate.mock.calls[0] as unknown[])[0] as {
      to: string;
      subject: string;
      template: string;
      metadata: Record<string, unknown>;
    };
    expect(args.to).toBe("admin@terroir-test.fr");
    expect(args.subject).toBe("[OPS] [REFUND_DB_DRIFT] order=ord-7");
    expect(args.template).toBe("admin_ops_alert");
    expect(args.metadata).toMatchObject({
      ops_prefix: "[REFUND_DB_DRIFT]",
      order_id: "ord-7",
    });
  });

  it("fail-safe : ne throw pas si Sentry throw", async () => {
    mockCaptureException.mockImplementationOnce(() => {
      throw new Error("Sentry SDK boom");
    });

    await expect(
      sendOpsAlert("[REFUND_DB_DRIFT]", new Error("x"), { order_id: "ord-9" }),
    ).resolves.toBeUndefined();
  });

  it("fail-safe : ne throw pas si email send rejette", async () => {
    mockSendTemplate.mockRejectedValueOnce(new Error("Resend down"));

    await expect(
      sendOpsAlert("[REFUND_DB_DRIFT]", new Error("y"), { order_id: "ord-10" }),
    ).resolves.toBeUndefined();
  });

  it("accepte error en string (pas d'instance Error)", async () => {
    await sendOpsAlert("[STRIPE_CHARGE_REFUNDED_NO_ORDER]", "raw string error", {
      charge_id: "ch_test",
    });
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
  });
});

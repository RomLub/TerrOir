import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// F-004 sub-2 helper + sub-3 caller — couverture standalone du helper
// reverseTransferIfNeeded (lib/stripe/reverse-transfer.ts). L'audit pré-launch
// 2026-05-10 recommandait des tests dédiés du helper en plus des intégrations
// par caller — reporté sub-2 (commit 9de460c) à sub-3 (ce commit) pour ne
// pas mélanger commit "intégrations" et commit "tests helper standalone".

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
});

const { mockCreateReversal, mockLogPaymentEvent } = vi.hoisted(() => ({
  mockCreateReversal: vi.fn(),
  mockLogPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    transfers: { createReversal: mockCreateReversal },
  },
}));
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: mockLogPaymentEvent,
}));

import { reverseTransferIfNeeded } from "@/lib/stripe/reverse-transfer";

type OrderRow = {
  id: string;
  transfer_id: string | null;
  producer_id: string | null;
};
type Resp<T> = { data: T | null; error: { message: string } | null };

function makeAdmin(orderResp: Resp<OrderRow>): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(orderResp),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  mockCreateReversal.mockReset();
  mockLogPaymentEvent.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reverseTransferIfNeeded — comportement standalone", () => {
  it("transfer_id présent → createReversal appelé + audit stripe_transfer_reversed + kind='reversed'", async () => {
    const admin = makeAdmin({
      data: {
        id: "order-1",
        transfer_id: "tr_payout_42",
        producer_id: "prod-1",
      },
      error: null,
    });
    mockCreateReversal.mockResolvedValueOnce({ id: "trr_abc123" });

    const result = await reverseTransferIfNeeded({
      admin,
      orderId: "order-1",
      amountEur: 100,
      source: "dispute_lost",
    });

    expect(result.kind).toBe("reversed");
    if (result.kind === "reversed") {
      expect(result.transferId).toBe("tr_payout_42");
      expect(result.reversalId).toBe("trr_abc123");
    }
    expect(mockCreateReversal).toHaveBeenCalledWith(
      "tr_payout_42",
      expect.objectContaining({
        amount: 10000, // 100€ → 10000 cents
        metadata: expect.objectContaining({
          order_id: "order-1",
          producer_id: "prod-1",
          source: "dispute_lost",
        }),
      }),
      expect.objectContaining({
        idempotencyKey: "reversal_order-1_dispute_lost",
      }),
    );
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_transfer_reversed",
        metadata: expect.objectContaining({
          order_id: "order-1",
          transfer_id: "tr_payout_42",
          reversal_id: "trr_abc123",
          source: "dispute_lost",
        }),
      }),
    );
  });

  it("transfer_id NULL (order pre-completion) → noop + AUCUN appel createReversal", async () => {
    const admin = makeAdmin({
      data: {
        id: "order-2",
        transfer_id: null,
        producer_id: "prod-1",
      },
      error: null,
    });

    const result = await reverseTransferIfNeeded({
      admin,
      orderId: "order-2",
      amountEur: 100,
      source: "refund_cancel",
    });

    expect(result.kind).toBe("noop_no_transfer_id");
    expect(result.transferId).toBeNull();
    expect(mockCreateReversal).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });

  it("lookup DB échoue → noop_lookup_failed + AUCUN appel createReversal", async () => {
    const admin = makeAdmin({
      data: null,
      error: { message: "connection reset" },
    });

    const result = await reverseTransferIfNeeded({
      admin,
      orderId: "order-3",
      amountEur: 50,
      source: "refund_admin",
    });

    expect(result.kind).toBe("noop_lookup_failed");
    if (result.kind === "noop_lookup_failed") {
      expect(result.error).toBe("connection reset");
    }
    expect(mockCreateReversal).not.toHaveBeenCalled();
  });

  it("Stripe createReversal throw → kind='failed' + audit stripe_transfer_reversal_failed", async () => {
    const admin = makeAdmin({
      data: {
        id: "order-4",
        transfer_id: "tr_obsolete",
        producer_id: "prod-1",
      },
      error: null,
    });
    mockCreateReversal.mockRejectedValueOnce(
      new Error("Connect account suspended"),
    );

    const result = await reverseTransferIfNeeded({
      admin,
      orderId: "order-4",
      amountEur: 100,
      source: "dispute_lost",
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.transferId).toBe("tr_obsolete");
      expect(result.error).toBe("Connect account suspended");
    }
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_transfer_reversal_failed",
        metadata: expect.objectContaining({
          order_id: "order-4",
          transfer_id: "tr_obsolete",
          source: "dispute_lost",
          error_message: "Connect account suspended",
        }),
      }),
    );
  });

  it("idempotencyHint custom override le suffixe default (source)", async () => {
    const admin = makeAdmin({
      data: {
        id: "order-5",
        transfer_id: "tr_payout_99",
        producer_id: "prod-1",
      },
      error: null,
    });
    mockCreateReversal.mockResolvedValueOnce({ id: "trr_idemp" });

    await reverseTransferIfNeeded({
      admin,
      orderId: "order-5",
      amountEur: 75,
      source: "refund_retry",
      idempotencyHint: "retry_3",
    });

    expect(mockCreateReversal).toHaveBeenCalledWith(
      "tr_payout_99",
      expect.any(Object),
      expect.objectContaining({
        idempotencyKey: "reversal_order-5_retry_3",
      }),
    );
  });
});

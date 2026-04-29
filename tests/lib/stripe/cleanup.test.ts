// Vitest pour lib/stripe/cleanup.ts —
// deleteStripeConnectAccount + deleteStripeCustomer (les 2 fail-open).
//
// Couverture T-421 partiel Bundle 5 — 4 cas :
//   B1 : deleteStripeConnectAccount + accounts.del OK → {success: true}
//   B2 : deleteStripeConnectAccount + accounts.del throw → {success: false, error}
//        (fail-open : flag pour cleanup manuel admin, ne bloque pas l'appelant)
//   B3 : deleteStripeCustomer + customers.del OK → {success: true}
//   B4 : deleteStripeCustomer + customers.del throw → {success: false, error}
//
// Pattern mocks aligné tests/lib/stripe/payouts.test.ts /
// tests/lib/stripe/retry-failed-refund.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockAccountsDel, mockCustomersDel } = vi.hoisted(() => ({
  mockAccountsDel: vi.fn(),
  mockCustomersDel: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    accounts: { del: mockAccountsDel },
    customers: { del: mockCustomersDel },
  },
}));

import {
  deleteStripeConnectAccount,
  deleteStripeCustomer,
} from "@/lib/stripe/cleanup";

const ACCOUNT_ID = "acct_test_123";
const CUSTOMER_ID = "cus_test_456";

beforeEach(() => {
  mockAccountsDel.mockReset();
  mockCustomersDel.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================

describe("deleteStripeConnectAccount — T-421 partiel", () => {
  it("B1 — accounts.del OK → {success: true} sans error", async () => {
    mockAccountsDel.mockResolvedValueOnce({ id: ACCOUNT_ID, deleted: true });

    const result = await deleteStripeConnectAccount(ACCOUNT_ID);

    expect(result).toEqual({ success: true });
    expect(mockAccountsDel).toHaveBeenCalledTimes(1);
    expect(mockAccountsDel).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it("B2 — accounts.del throw → fail-open {success: false, error: <message>}", async () => {
    mockAccountsDel.mockRejectedValueOnce(
      new Error("Account has activity, cannot be deleted"),
    );

    const result = await deleteStripeConnectAccount(ACCOUNT_ID);

    expect(result).toEqual({
      success: false,
      error: "Account has activity, cannot be deleted",
    });
    // Confirme : pas de re-throw — le fail-open est essentiel pour que
    // l'appelant continue (RGPD purge, flag stripe_cleanup_pending, etc.).
    expect(mockAccountsDel).toHaveBeenCalledTimes(1);
  });
});

describe("deleteStripeCustomer — T-421 partiel", () => {
  it("B3 — customers.del OK → {success: true} sans error", async () => {
    mockCustomersDel.mockResolvedValueOnce({ id: CUSTOMER_ID, deleted: true });

    const result = await deleteStripeCustomer(CUSTOMER_ID);

    expect(result).toEqual({ success: true });
    expect(mockCustomersDel).toHaveBeenCalledTimes(1);
    expect(mockCustomersDel).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it("B4 — customers.del throw → fail-open {success: false, error: <message>}", async () => {
    mockCustomersDel.mockRejectedValueOnce(new Error("rate_limited"));

    const result = await deleteStripeCustomer(CUSTOMER_ID);

    expect(result).toEqual({ success: false, error: "rate_limited" });
    expect(mockCustomersDel).toHaveBeenCalledTimes(1);
  });
});

// Vitest pour POST /api/stripe/ensure-default-payment-method.
//
// Couverture T-421 partiel Bundle 5 :
//   - Auth + Zod (2) : pas de session 401, body invalide 400
//   - Ownership (2) : order not found 404, mismatch consumer_id 403
//   - Customer lookup (2) : no_customer 200, customer_deleted 200
//   - Payment methods (1) : no_payment_methods 200
//   - Default already set (1) : changed:false no-op
//   - Happy path + dedupe (3) : create default 200 (+ assert logPaymentEvent
//     posé event_type stripe_default_payment_method_set sur paths F1+F2 —
//     T-431 résolu), dedupe + create 200, dedupe sans update 200
//   - Edge fingerprint (1) : fingerprints différents → pas de detach
//
// Pattern mocks aligné tests/app/api/stripe/connect/onboard/route.test.ts
// (Bundle 2 PR 2b TC). Spécificités :
//   - Double mock Supabase : server (ownership orders) + admin
//     (users.stripe_customer_id)
//   - Mock Stripe SDK : customers.retrieve/update + paymentMethods.list/detach

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Stripe SDK mocks (hoisted) ------------------------------------------

const {
  mockCustomersRetrieve,
  mockCustomersUpdate,
  mockPaymentMethodsList,
  mockPaymentMethodsDetach,
  mockLogPaymentEvent,
} = vi.hoisted(() => ({
  mockCustomersRetrieve: vi.fn(),
  mockCustomersUpdate: vi.fn(),
  mockPaymentMethodsList: vi.fn(),
  mockPaymentMethodsDetach: vi.fn(),
  mockLogPaymentEvent: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    customers: {
      retrieve: mockCustomersRetrieve,
      update: mockCustomersUpdate,
    },
    paymentMethods: {
      list: mockPaymentMethodsList,
      detach: mockPaymentMethodsDetach,
    },
  },
}));

// Mock standard logPaymentEvent ; T-431 résolu : la route pose un audit_log
// event_type stripe_default_payment_method_set sur les paths F1 (1 PM, set
// default) et F2 (dedupe + set default). F3 (detach seul sans default change)
// et E1 (no-op default déjà set) ne posent PAS d'event.
vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: mockLogPaymentEvent,
}));

// --- Auth mock (closure variable) ----------------------------------------

type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

// --- Supabase server mock (ownership orders) -----------------------------

type Resp = { data?: unknown; error?: unknown };

let orderLookupResp: Resp;
let userLookupResp: Resp;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (_table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = (_cols: string) => builder;
      builder.eq = (_col: string, _val: unknown) => builder;
      builder.maybeSingle = () => Promise.resolve(orderLookupResp);
      return builder;
    },
  }),
}));

// --- Supabase admin mock (users.stripe_customer_id) ----------------------

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (_table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = (_cols: string) => builder;
      builder.eq = (_col: string, _val: unknown) => builder;
      builder.maybeSingle = () => Promise.resolve(userLookupResp);
      return builder;
    },
  }),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/stripe/ensure-default-payment-method/route";

// --- Constants -----------------------------------------------------------

const CONSUMER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "cus_test_abc";
const PM_NEW_ID = "pm_new_recent";
const PM_EXISTING_ID = "pm_existing_older";

// Stripe.Customer minimal (cast en runtime — la signature complète est
// volumineuse, le code n'utilise que .deleted et .invoice_settings).
function customerOk(opts?: { defaultPm?: string | null }) {
  return {
    id: CUSTOMER_ID,
    deleted: false,
    invoice_settings: {
      default_payment_method: opts?.defaultPm ?? null,
    },
  } as unknown as object;
}

function customerDeleted() {
  return { id: CUSTOMER_ID, deleted: true } as unknown as object;
}

function pm(id: string, fingerprint: string | null) {
  return {
    id,
    card: fingerprint === null ? undefined : { fingerprint },
  } as unknown as object;
}

function pmList(...pms: object[]) {
  return { data: pms, has_more: false } as unknown as object;
}

function makeRequest(body: unknown = { order_id: ORDER_ID }): Request {
  return { json: async () => body } as unknown as Request;
}

function defaultSession(): SessionUser {
  return {
    id: CONSUMER_ID,
    email: "consumer@example.com",
    roles: ["consumer"],
    isAdmin: false,
  };
}

// --- Setup / teardown ----------------------------------------------------

beforeEach(() => {
  sessionUser = defaultSession();
  orderLookupResp = {
    data: { id: ORDER_ID, consumer_id: CONSUMER_ID },
    error: null,
  };
  userLookupResp = {
    data: { stripe_customer_id: CUSTOMER_ID },
    error: null,
  };
  mockCustomersRetrieve.mockReset().mockResolvedValue(customerOk());
  mockCustomersUpdate.mockReset().mockResolvedValue(customerOk());
  mockPaymentMethodsList
    .mockReset()
    .mockResolvedValue(pmList(pm(PM_NEW_ID, "fp_new")));
  mockPaymentMethodsDetach.mockReset().mockResolvedValue({ id: PM_NEW_ID });
  mockLogPaymentEvent.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// A. Auth + validation Zod
// =============================================================================

describe("A. Auth + Zod", () => {
  it("A1 — pas de session → 401, aucun I/O Stripe ni Supabase", async () => {
    sessionUser = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
    expect(mockPaymentMethodsList).not.toHaveBeenCalled();
  });

  it("A2 — body sans order_id ou order_id non-uuid → 400", async () => {
    const res = await POST(makeRequest({ order_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
  });
});

// =============================================================================
// B. Ownership (orders + consumer_id match)
// =============================================================================

describe("B. Ownership", () => {
  it("B1 — SELECT orders renvoie null → 404 'Order not found'", async () => {
    orderLookupResp = { data: null, error: null };
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Order not found" });
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
  });

  it("B2 — order existe + consumer_id != session.id → 403 'Forbidden'", async () => {
    orderLookupResp = {
      data: { id: ORDER_ID, consumer_id: "other-consumer-uuid" },
      error: null,
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
  });
});

// =============================================================================
// C. Customer lookup (Supabase admin + Stripe retrieve)
// =============================================================================

describe("C. Customer lookup", () => {
  it("C1 — users.stripe_customer_id null → 200 {success:false, reason:'no_customer'}", async () => {
    userLookupResp = { data: { stripe_customer_id: null }, error: null };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, reason: "no_customer" });
    expect(mockCustomersRetrieve).not.toHaveBeenCalled();
  });

  it("C2 — stripe.customers.retrieve renvoie {deleted:true} → 200 {success:false, reason:'customer_deleted'}", async () => {
    mockCustomersRetrieve.mockResolvedValueOnce(customerDeleted());
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: false,
      reason: "customer_deleted",
    });
    expect(mockPaymentMethodsList).not.toHaveBeenCalled();
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
  });
});

// =============================================================================
// D. No payment methods
// =============================================================================

describe("D. Payment methods empty", () => {
  it("D1 — paymentMethods.list.data vide → 200 {success:false, reason:'no_payment_methods'}", async () => {
    mockPaymentMethodsList.mockResolvedValueOnce(pmList());
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: false,
      reason: "no_payment_methods",
    });
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
    expect(mockPaymentMethodsDetach).not.toHaveBeenCalled();
  });
});

// =============================================================================
// E. Default already set (no dedupe)
// =============================================================================

describe("E. Default already set", () => {
  it("E1 — currentDefault non-null + 1 PM → {success:true, changed:false}, pas d'update ni detach", async () => {
    mockCustomersRetrieve.mockResolvedValueOnce(
      customerOk({ defaultPm: "pm_already_default" }),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, changed: false });
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
    expect(mockPaymentMethodsDetach).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

// =============================================================================
// F. Happy path + dedupe variants
// =============================================================================

describe("F. Happy path + dedupe", () => {
  it("F1 — pas de default + 1 PM → customers.update avec default_payment_method + 200 (+ logPaymentEvent absent T-431)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      changed: true,
      payment_method_id: PM_NEW_ID,
    });
    expect(mockCustomersUpdate).toHaveBeenCalledTimes(1);
    expect(mockCustomersUpdate).toHaveBeenCalledWith(CUSTOMER_ID, {
      invoice_settings: { default_payment_method: PM_NEW_ID },
    });
    expect(mockPaymentMethodsDetach).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_default_payment_method_set",
        userId: CONSUMER_ID,
        metadata: expect.objectContaining({
          customer_id: CUSTOMER_ID,
          payment_method_id: PM_NEW_ID,
          order_id: ORDER_ID,
        }),
      }),
    );
  });

  it("F2 — pas de default + 2 PMs même fingerprint → detach pms[0], update avec pms[1]", async () => {
    mockPaymentMethodsList.mockResolvedValueOnce(
      pmList(pm(PM_NEW_ID, "fp_dup"), pm(PM_EXISTING_ID, "fp_dup")),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      changed: true,
      payment_method_id: PM_EXISTING_ID,
      dedupeDetached: PM_NEW_ID,
    });
    expect(mockPaymentMethodsDetach).toHaveBeenCalledTimes(1);
    expect(mockPaymentMethodsDetach).toHaveBeenCalledWith(PM_NEW_ID);
    expect(mockCustomersUpdate).toHaveBeenCalledTimes(1);
    expect(mockCustomersUpdate).toHaveBeenCalledWith(CUSTOMER_ID, {
      invoice_settings: { default_payment_method: PM_EXISTING_ID },
    });
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_default_payment_method_set",
        userId: CONSUMER_ID,
        metadata: expect.objectContaining({
          customer_id: CUSTOMER_ID,
          payment_method_id: PM_EXISTING_ID,
          order_id: ORDER_ID,
          dedupe_detached_id: PM_NEW_ID,
        }),
      }),
    );
  });

  it("F3 — default DÉJÀ set + 2 PMs même fingerprint → detach pms[0], pas de customers.update", async () => {
    mockCustomersRetrieve.mockResolvedValueOnce(
      customerOk({ defaultPm: PM_EXISTING_ID }),
    );
    mockPaymentMethodsList.mockResolvedValueOnce(
      pmList(pm(PM_NEW_ID, "fp_dup"), pm(PM_EXISTING_ID, "fp_dup")),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      changed: false,
      dedupeDetached: PM_NEW_ID,
    });
    expect(mockPaymentMethodsDetach).toHaveBeenCalledWith(PM_NEW_ID);
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

// =============================================================================
// G. Edge fingerprint (no dedupe trigger)
// =============================================================================

describe("G. Edge fingerprint", () => {
  it("G1 — 2 PMs avec fingerprints différents → pas de detach, update avec pms[0]", async () => {
    mockPaymentMethodsList.mockResolvedValueOnce(
      pmList(pm(PM_NEW_ID, "fp_a"), pm(PM_EXISTING_ID, "fp_b")),
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.changed).toBe(true);
    expect(body.payment_method_id).toBe(PM_NEW_ID);
    expect("dedupeDetached" in body).toBe(false);
    expect(mockPaymentMethodsDetach).not.toHaveBeenCalled();
    expect(mockCustomersUpdate).toHaveBeenCalledWith(CUSTOMER_ID, {
      invoice_settings: { default_payment_method: PM_NEW_ID },
    });
  });
});

// =============================================================================
// H. T-433 try/catch fail-open Stripe errors
// =============================================================================
// Option C hybride fail-open : 4 try/catch granulaires, retournent
// 200 + {success: false, reason: 'stripe_error_*'}. Cohérent contrat
// documenté en tête de route ("Fail-open côté client : si ça échoue, pas
// de blocage"). Logs greppables [ENSURE_DEFAULT_*_ERR] pour traçabilité
// forensique. Audit log NON posé sur fail paths (cohérent T-429 audit =
// mutation effective).

describe("H. T-433 try/catch fail-open", () => {
  it("T13 — customers.retrieve throw → 200 + reason stripe_error_retrieve_customer + no audit log", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCustomersRetrieve.mockReset().mockRejectedValueOnce(
      new Error("network timeout"),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: false,
      reason: "stripe_error_retrieve_customer",
    });
    expect(mockPaymentMethodsList).not.toHaveBeenCalled();
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[ENSURE_DEFAULT_RETRIEVE_CUSTOMER_ERR\]/),
    );
  });

  it("T14 — paymentMethods.list throw → 200 + reason stripe_error_list_pms + no audit log", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockPaymentMethodsList.mockReset().mockRejectedValueOnce(
      new Error("rate_limit_exceeded"),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: false,
      reason: "stripe_error_list_pms",
    });
    expect(mockCustomersUpdate).not.toHaveBeenCalled();
    expect(mockPaymentMethodsDetach).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[ENSURE_DEFAULT_LIST_PMS_ERR\]/),
    );
  });

  it("T15 — paymentMethods.detach throw (path dedupe) → Q7 fail-open extension : update continue avec pms[0] + dedupeFailed:true + audit log posé", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 2 PMs même fingerprint → trigger dedupe path. Detach échoue, mais
    // le flow continue avec refPm = pms[0] (PM fraîchement attaché).
    mockPaymentMethodsList.mockResolvedValueOnce(
      pmList(pm(PM_NEW_ID, "fp_dup"), pm(PM_EXISTING_ID, "fp_dup")),
    );
    mockPaymentMethodsDetach.mockReset().mockRejectedValueOnce(
      new Error("PM already detached"),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      changed: true,
      payment_method_id: PM_NEW_ID, // refPm reste pms[0] (detach failed)
      dedupeFailed: true, // flag Q7 pour audit ultérieur (T-441)
    });
    // customers.update est appelé avec PM_NEW_ID (pas PM_EXISTING_ID)
    expect(mockCustomersUpdate).toHaveBeenCalledTimes(1);
    expect(mockCustomersUpdate).toHaveBeenCalledWith(CUSTOMER_ID, {
      invoice_settings: { default_payment_method: PM_NEW_ID },
    });
    // Audit log posé sur update success (cohérent T-431)
    expect(mockLogPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe_default_payment_method_set",
        userId: CONSUMER_ID,
        metadata: expect.objectContaining({
          customer_id: CUSTOMER_ID,
          payment_method_id: PM_NEW_ID,
          order_id: ORDER_ID,
        }),
      }),
    );
    // dedupe_detached_id NON présent dans metadata (detach failed)
    const auditCall = mockLogPaymentEvent.mock.calls[0]?.[0] as {
      metadata: Record<string, unknown>;
    };
    expect("dedupe_detached_id" in auditCall.metadata).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[ENSURE_DEFAULT_DETACH_PM_ERR\]/),
    );
  });

  it("T16 — customers.update throw → 200 + reason stripe_error_update_customer + no audit log", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCustomersUpdate.mockReset().mockRejectedValueOnce(
      new Error("invalid_request_error"),
    );

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: false,
      reason: "stripe_error_update_customer",
    });
    // Audit NON posé (cohérent T-429 pattern : audit = mutation effective)
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[ENSURE_DEFAULT_UPDATE_CUSTOMER_ERR\]/),
    );
  });
});

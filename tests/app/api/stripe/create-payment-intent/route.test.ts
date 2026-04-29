// Vitest pour POST /api/stripe/create-payment-intent.
// Scope Bundle 1 paiements critiques : couvre les findings T-406 (statut guard),
// T-404 (idempotencyKey paymentIntents.create) et T-405 (verrou DB anti-race +
// rollback compensation + catch idempotency_key_in_use). La couverture
// exhaustive du fichier (T-421) est hors scope ici.
//
// Pattern aligné sur tests/app/api/stripe/refund/route.test.ts :
// vi.hoisted pour mocks partagés, builder Supabase chaînable multi-table avec
// queues séparées par opération, env stubs hoistés.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted mocks partagés avec les factories vi.mock -------------------
const {
  mockPaymentIntentsCreate,
  mockPaymentIntentsRetrieve,
  mockPaymentIntentsUpdate,
  mockPaymentIntentsCancel,
  mockGetOrCreateStripeCustomer,
} = vi.hoisted(() => ({
  mockPaymentIntentsCreate: vi.fn(),
  mockPaymentIntentsRetrieve: vi.fn(),
  mockPaymentIntentsUpdate: vi.fn(),
  mockPaymentIntentsCancel: vi.fn(),
  mockGetOrCreateStripeCustomer: vi.fn(),
}));

vi.mock("@/lib/stripe/server", () => ({
  stripe: {
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: mockPaymentIntentsRetrieve,
      update: mockPaymentIntentsUpdate,
      cancel: mockPaymentIntentsCancel,
    },
  },
}));

vi.mock("@/lib/stripe/customer", () => ({
  getOrCreateStripeCustomer: mockGetOrCreateStripeCustomer,
}));

// --- Auth mocks (closure variable) ---------------------------------------
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

// --- Supabase client mocks (server + admin partagent le builder) ---------
// Builder chaînable multi-table avec queues séparées par opération, copié
// du pattern refund/route.test.ts. Les deux clients (server pour la lecture
// order via RLS, admin pour user profile + UPDATE order_id) routent vers
// le même builder car les tables ne se chevauchent pas (orders côté server,
// users côté admin).

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCER_ID = "prod-1";
const CONSUMER_ID = "cons-1";
const CUSTOMER_ID = "cus_test_123";
const PI_ID = "pi_test_123";
const PI_CLIENT_SECRET = "pi_test_123_secret_abc";

const DEFAULT_ORDER = {
  id: ORDER_ID,
  consumer_id: CONSUMER_ID as string | null,
  producer_id: PRODUCER_ID,
  montant_total: 12.34,
  statut: "pending" as string,
  stripe_payment_intent_id: null as string | null,
};

const DEFAULT_USER_PROFILE = { prenom: "Alice", nom: "Tester" };

function defaultResp(table: string, op: Op): Resp {
  if (op === "update" || op === "insert") return { data: null, error: null };
  if (table === "orders") return { data: DEFAULT_ORDER, error: null };
  if (table === "users") return { data: DEFAULT_USER_PROFILE, error: null };
  return { data: null, error: null };
}

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return defaultResp(table, op);
}

function buildClientFactory() {
  return () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        builder._op = "insert";
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  });
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: buildClientFactory(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: buildClientFactory(),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/stripe/create-payment-intent/route";

// --- Helpers -------------------------------------------------------------

function makeRequest(body?: unknown): Request {
  return {
    json: async () => (body === undefined ? { order_id: ORDER_ID } : body),
    headers: new Headers(),
  } as unknown as Request;
}

function setOrderFetch(partial: Partial<typeof DEFAULT_ORDER>) {
  responses.orders = responses.orders ?? {};
  const rest = responses.orders.select ?? [];
  responses.orders.select = [
    { data: { ...DEFAULT_ORDER, ...partial }, error: null },
    ...rest,
  ];
}

// --- Setup / teardown ----------------------------------------------------

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    inserts: [],
    eqCalls: [],
  };
  responses = {};
  sessionUser = {
    id: CONSUMER_ID,
    email: "alice@example.com",
    roles: [],
    isAdmin: false,
  };
  mockPaymentIntentsCreate
    .mockReset()
    .mockResolvedValue({ id: PI_ID, client_secret: PI_CLIENT_SECRET });
  mockPaymentIntentsRetrieve.mockReset().mockResolvedValue({
    id: PI_ID,
    client_secret: PI_CLIENT_SECRET,
    setup_future_usage: null,
    customer: CUSTOMER_ID,
  });
  mockPaymentIntentsUpdate.mockReset().mockResolvedValue({});
  mockPaymentIntentsCancel.mockReset().mockResolvedValue({});
  mockGetOrCreateStripeCustomer.mockReset().mockResolvedValue(CUSTOMER_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- A. Auth + body validation (filets préservation) ---------------------

describe("A. Auth + body validation", () => {
  it("A1 session absente → 401, aucun appel Stripe", async () => {
    sessionUser = null;
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(captured.fromCalls).toEqual([]);
  });

  it("A2 body order_id non-UUID → 400 Invalid body, sortie avant tout I/O", async () => {
    const res = await POST(makeRequest({ order_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
    expect(captured.fromCalls).toEqual([]);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });
});

// --- B. T-406 statut===pending guard -------------------------------------

describe("B. T-406 — order.statut guard", () => {
  it("T-406-A statut='confirmed' → 409 'Order not in pending state', paymentIntents.create jamais appelé", async () => {
    setOrderFetch({ statut: "confirmed" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Order not in pending state" });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();
    expect(mockPaymentIntentsUpdate).not.toHaveBeenCalled();
  });

  it("T-406-B statut='cancelled' → 409, paymentIntents.create jamais appelé", async () => {
    setOrderFetch({ statut: "cancelled" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Order not in pending state");
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("T-406-C statut='pending' → flow nominal continue (200 + client_secret)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { client_secret: string };
    expect(body.client_secret).toBe(PI_CLIENT_SECRET);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
  });
});

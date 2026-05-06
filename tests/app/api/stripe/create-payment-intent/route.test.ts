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
  mockConsumeRateLimit,
  StripeIdempotencyError,
} = vi.hoisted(() => {
  // Mock minimal de Stripe.errors.StripeIdempotencyError pour les tests T-405
  // qui simulent une collision de cle. Le code production utilise `instanceof
  // Stripe.errors.StripeIdempotencyError` → on doit injecter la meme classe.
  class StripeIdempotencyError extends Error {
    readonly type = "StripeIdempotencyError" as const;
    readonly rawType = "idempotency_error" as const;
    constructor(message: string) {
      super(message);
      this.name = "StripeIdempotencyError";
    }
  }
  return {
    mockPaymentIntentsCreate: vi.fn(),
    mockPaymentIntentsRetrieve: vi.fn(),
    mockPaymentIntentsUpdate: vi.fn(),
    mockPaymentIntentsCancel: vi.fn(),
    mockGetOrCreateStripeCustomer: vi.fn(),
    mockConsumeRateLimit: vi.fn(),
    StripeIdempotencyError,
  };
});

// Audit Stripe pré-launch W-2 : mock @/lib/rate-limit pour éviter le
// warn lazy-init Upstash en CI. Default beforeEach = success:true → tous
// les tests historiques traversent le rate-limit transparent.
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mockConsumeRateLimit,
  getStripeCreatePaymentIntentRateLimit: () => null,
}));

// Mock du module `stripe` (default export Stripe class) pour exposer
// `Stripe.errors.StripeIdempotencyError` dans le code production. Le client
// Stripe lui-meme est mocke via @/lib/stripe/server.
vi.mock("stripe", () => {
  const Stripe = function () {} as unknown as {
    errors: { StripeIdempotencyError: typeof StripeIdempotencyError };
  };
  Stripe.errors = { StripeIdempotencyError };
  return { default: Stripe };
});

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
// Audit Stripe M-6 : guard pré-PI charges_enabled. Defaut "ready" → tous les
// tests historiques continuent de passer le guard sans modif.
const DEFAULT_PRODUCER_STRIPE = { stripe_charges_enabled: true };

function defaultResp(table: string, op: Op): Resp {
  // T-405 : l'UPDATE de create-payment-intent route utilise `.select("id")`
  // pour exposer les rows touchees → defaut "1 row touched" pour le happy path.
  // Les tests race (T-405-A/B) overrident a `[]` (0 rows = race detectee).
  if (op === "update" && table === "orders")
    return { data: [{ id: ORDER_ID }], error: null };
  if (op === "update" || op === "insert") return { data: null, error: null };
  if (table === "orders") return { data: DEFAULT_ORDER, error: null };
  if (table === "users") return { data: DEFAULT_USER_PROFILE, error: null };
  if (table === "producers")
    return { data: DEFAULT_PRODUCER_STRIPE, error: null };
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
        // PostgREST autorise `.update().select()` pour exposer les rows
        // touchees : on conserve _op="update" pour consommer la bonne queue.
        if (builder._op === "pending") builder._op = "select";
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
      // `.is(col, val)` PostgREST : noop chainable cote test (filtre cote DB).
      builder.is = (_col: string, _val: unknown) => builder;
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
  mockConsumeRateLimit.mockReset().mockResolvedValue({
    success: true,
    limit: 10,
    remaining: 9,
    reset: Date.now() + 60_000,
  });
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

// --- B'. Audit Stripe M-6 — guard producer.stripe_charges_enabled --------

describe("B'. Audit Stripe M-6 — producer charges_enabled guard", () => {
  it("M-6-A producer.stripe_charges_enabled=false → 409 'producer_not_ready', paymentIntents.create jamais appelé", async () => {
    responses.producers = responses.producers ?? {};
    responses.producers.select = [
      { data: { stripe_charges_enabled: false }, error: null },
    ];
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "producer_not_ready" });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(mockGetOrCreateStripeCustomer).not.toHaveBeenCalled();
  });

  it("M-6-B producer introuvable (data=null) → 409 'producer_not_ready'", async () => {
    responses.producers = responses.producers ?? {};
    responses.producers.select = [{ data: null, error: null }];
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "producer_not_ready" });
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });
});

// --- C. T-404 idempotencyKey paymentIntents.create -----------------------

describe("C. T-404 — idempotencyKey passe en 2e arg de paymentIntents.create", () => {
  it("T-404 happy path → create appele avec ({...params}, { idempotencyKey: 'pi_create_<order.id>' })", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    const call = mockPaymentIntentsCreate.mock.calls[0]!;
    // 1er arg : params metier (montant, currency, customer, metadata...).
    const [params, options] = call as [Record<string, unknown>, { idempotencyKey: string }];
    expect(params.amount).toBe(Math.round(12.34 * 100));
    expect(params.currency).toBe("eur");
    // 2e arg : idempotency stable sur l'UUID order.
    expect(options).toEqual({ idempotencyKey: `pi_create_${ORDER_ID}` });
  });
});

// --- C'. Audit Stripe M-1 — automatic_payment_methods (Card+ApplePay+GooglePay)
// remplace payment_method_types: ['card'] hardcodé. allow_redirects:'never'
// préserve le flow single-page (pas de SEPA Debit redirect / Bancontact / iDEAL).

describe("C'. Audit Stripe M-1 — automatic_payment_methods config", () => {
  it("M-1-A PI cree avec automatic_payment_methods.enabled=true et allow_redirects='never'", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    const [params] = mockPaymentIntentsCreate.mock.calls[0]! as [
      Record<string, unknown>,
      unknown,
    ];
    expect(params.automatic_payment_methods).toEqual({
      enabled: true,
      allow_redirects: "never",
    });
  });

  it("M-1-B payment_method_types n'est plus passe (laisse Stripe Dashboard piloter le set)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const [params] = mockPaymentIntentsCreate.mock.calls[0]! as [
      Record<string, unknown>,
      unknown,
    ];
    expect(params.payment_method_types).toBeUndefined();
  });
});

// --- C''. T-228 — verrou contractuel metadata Stripe : allowlist stricte, pas
// de fuite des champs T-200 (mode_elevage, alimentation, densite_animale) ni
// probatoire DGCCRF (declaration_indicateurs_*) chez le sous-traitant Stripe.
// Doctrine : metadata Stripe = identifiants TerrOir uniquement.
// cf. docs/security/audit-stripe-metadata-t200-2026-05-06.md

describe("C''. T-228 — metadata Stripe : allowlist stricte (defense-in-depth)", () => {
  it("metadata = exactement {order_id, producer_id, consumer_id} sur PaymentIntent.create", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const [params] = mockPaymentIntentsCreate.mock.calls[0]! as [
      Record<string, unknown>,
      unknown,
    ];
    expect(params.metadata).toEqual({
      order_id: ORDER_ID,
      producer_id: PRODUCER_ID,
      consumer_id: CONSUMER_ID,
    });
    const keys = Object.keys(params.metadata as Record<string, unknown>).sort();
    expect(keys).toEqual(["consumer_id", "order_id", "producer_id"]);
  });

  it("metadata ne contient aucun champ T-200 (mode_elevage / alimentation / densite_animale)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const [params] = mockPaymentIntentsCreate.mock.calls[0]! as [
      Record<string, unknown>,
      unknown,
    ];
    const meta = params.metadata as Record<string, unknown>;
    expect(meta.mode_elevage).toBeUndefined();
    expect(meta.alimentation).toBeUndefined();
    expect(meta.densite_animale).toBeUndefined();
  });

  it("metadata ne contient aucun champ probatoire DGCCRF (declaration_indicateurs_*)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const [params] = mockPaymentIntentsCreate.mock.calls[0]! as [
      Record<string, unknown>,
      unknown,
    ];
    const meta = params.metadata as Record<string, unknown>;
    const probatoireKeys = Object.keys(meta).filter((k) =>
      k.startsWith("declaration_indicateurs"),
    );
    expect(probatoireKeys).toEqual([]);
  });
});

// --- D. T-405 verrou DB anti-race + rollback + catch idempotency reuse ---

describe("D. T-405 — race protection + rollback compensation", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("T-405-A UPDATE 0 rows touchees + cancel rollback OK → log absent, retrieve PI gagnant, 200", async () => {
    // Simule la race : UPDATE retourne data=[] (un autre flow a deja persiste).
    responses.orders = {
      update: [{ data: [], error: null }],
      // Le requery DB doit ensuite renvoyer le PI ID gagnant.
      select: [
        { data: DEFAULT_ORDER, error: null }, // 1er SELECT initial
        { data: { stripe_payment_intent_id: "pi_winning_456" }, error: null },
      ],
    };
    mockPaymentIntentsRetrieve.mockReset().mockResolvedValueOnce({
      id: "pi_winning_456",
      client_secret: "pi_winning_456_secret_xyz",
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ client_secret: "pi_winning_456_secret_xyz" });

    // Cancel rollback appele sur le PI orphelin.
    expect(mockPaymentIntentsCancel).toHaveBeenCalledTimes(1);
    expect(mockPaymentIntentsCancel).toHaveBeenCalledWith(PI_ID);
    // Cancel a reussi → pas de log [CREATE_PI_RACE_ROLLBACK].
    const warnCalls = consoleWarnSpy.mock.calls.map((c: unknown[]) =>
      String(c[0] ?? ""),
    );
    expect(warnCalls.some((m: string) => m.includes("[CREATE_PI_RACE_ROLLBACK]"))).toBe(false);
    // Retrieve PI gagnant emis.
    expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith("pi_winning_456");
  });

  it("T-405-B UPDATE 0 rows + Stripe cancel throw → log [CREATE_PI_RACE_ROLLBACK] greppable, retrieve continue", async () => {
    responses.orders = {
      update: [{ data: [], error: null }],
      select: [
        { data: DEFAULT_ORDER, error: null },
        { data: { stripe_payment_intent_id: "pi_winning_456" }, error: null },
      ],
    };
    mockPaymentIntentsCancel
      .mockReset()
      .mockRejectedValueOnce(new Error("intent_already_succeeded"));
    mockPaymentIntentsRetrieve.mockReset().mockResolvedValueOnce({
      id: "pi_winning_456",
      client_secret: "pi_winning_456_secret_xyz",
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // Log greppable contient order, pi orphelin, raison.
    const warnCalls = consoleWarnSpy.mock.calls.map((c: unknown[]) =>
      String(c[0] ?? ""),
    );
    const rollbackLog = warnCalls.find((m: string) => m.includes("[CREATE_PI_RACE_ROLLBACK]"));
    expect(rollbackLog).toBeDefined();
    expect(rollbackLog!).toContain(ORDER_ID);
    expect(rollbackLog!).toContain(PI_ID);
    expect(rollbackLog!).toContain("intent_already_succeeded");
    // Retrieve PI gagnant emis malgre echec cancel (best-effort).
    expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith("pi_winning_456");
  });

  it("T-405-C UPDATE 1 row touchee → flow nominal sans rollback (pas de cancel, pas de retrieve)", async () => {
    // Default UPDATE response = [{ id: ORDER_ID }] (1 row) → path nominal.
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ client_secret: PI_CLIENT_SECRET });
    expect(mockPaymentIntentsCancel).not.toHaveBeenCalled();
    expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();
  });

  it("T-405-D paymentIntents.create throw StripeIdempotencyError → catch + requery DB + retrieve PI gagnant + log [CREATE_PI_IDEMPOTENCY_REUSE]", async () => {
    mockPaymentIntentsCreate
      .mockReset()
      .mockRejectedValueOnce(
        new StripeIdempotencyError("Keys for idempotent requests can only be used with the same parameters they were first used with."),
      );
    // Requery DB renvoie le PI ID gagnant pose par la 1re requete.
    responses.orders = {
      select: [
        { data: DEFAULT_ORDER, error: null }, // SELECT initial
        { data: { stripe_payment_intent_id: "pi_winning_999" }, error: null }, // requery post-error
      ],
    };
    mockPaymentIntentsRetrieve.mockReset().mockResolvedValueOnce({
      id: "pi_winning_999",
      client_secret: "pi_winning_999_secret",
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ client_secret: "pi_winning_999_secret" });

    // Pas de UPDATE/cancel : on est sorti via le catch idempotency.
    expect(mockPaymentIntentsCancel).not.toHaveBeenCalled();
    expect(captured.updates).toEqual([]);
    // Log greppable [CREATE_PI_IDEMPOTENCY_REUSE].
    const warnCalls = consoleWarnSpy.mock.calls.map((c: unknown[]) =>
      String(c[0] ?? ""),
    );
    const reuseLog = warnCalls.find((m: string) => m.includes("[CREATE_PI_IDEMPOTENCY_REUSE]"));
    expect(reuseLog).toBeDefined();
    expect(reuseLog!).toContain(ORDER_ID);
    expect(reuseLog!).toContain("idempotent");
    // Retrieve emis sur le PI gagnant.
    expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith("pi_winning_999");
  });
});

// --- E. Audit Stripe pré-launch W-2 — rate-limit applicatif --------------
// Cap 10/60s user-keyed. consumeRateLimit success=false → 429 + retry_after,
// pas d'appel Stripe. Le path success=true par defaut beforeEach couvre
// l'absence de régression (cf. tous les tests A→D).

describe("E. W-2 — rate-limit applicatif (10/60s user-keyed)", () => {
  it("E1 rate-limit non dépassé (success=true) → flow nominal 200", async () => {
    // Cas explicite : success:true par defaut beforeEach. On verifie aussi
    // que consumeRateLimit a bien ete appele avec session.id.
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mockConsumeRateLimit.mock.calls[0]?.[1]).toBe(CONSUMER_ID);
    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
  });

  it("E2 rate-limit dépassé (success=false) → 429 + retry_after + Retry-After header, aucun appel Stripe", async () => {
    const reset = Date.now() + 30_000;
    mockConsumeRateLimit.mockResolvedValueOnce({
      success: false,
      limit: 10,
      remaining: 0,
      reset,
    });
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(makeRequest());
    const body = (await res.json()) as { error: string; retry_after: number };

    expect(res.status).toBe(429);
    expect(body.error).toBe("rate_limited");
    expect(body.retry_after).toBeGreaterThan(0);
    expect(body.retry_after).toBeLessThanOrEqual(31);
    expect(res.headers.get("Retry-After")).toBe(String(body.retry_after));

    // Aucun appel Stripe / Supabase metier après refus rate-limit.
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(mockGetOrCreateStripeCustomer).not.toHaveBeenCalled();
    expect(captured.fromCalls).toEqual([]);

    // Log greppable [STRIPE_CREATE_PI_RATE_LIMITED] avec userId + cap.
    const warnCalls = consoleWarnSpy.mock.calls.map((c: unknown[]) =>
      String(c[0] ?? ""),
    );
    const rlLog = warnCalls.find((m: string) =>
      m.includes("[STRIPE_CREATE_PI_RATE_LIMITED]"),
    );
    expect(rlLog).toBeDefined();
    expect(rlLog!).toContain(`user=${CONSUMER_ID}`);
    expect(rlLog!).toContain("cap=10");
  });
});

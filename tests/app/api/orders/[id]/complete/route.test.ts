// Vitest pour POST /api/orders/[id]/complete.
// Couverture : zod body (code_commande required), auth, order lookup,
// idempotence, autorisation, state machine (assertTransition vers completed
// depuis confirmed — modèle 3 états réel : pickup direct depuis confirmed),
// code_commande check (case-insensitive trim), UPDATE orders, email
// review_request_j0.
// Pas de revalidateTag (intentionnel — la commande reste dans le filtre
// IN ('confirmed','completed')).
//
// Cluster C — T6 cleanup : 'ready' a été retiré du modèle (CHECK
// orders.statut + union TS). Default order statut bascule à 'confirmed'.
//
// LOT 5 chantier pickup-validation 2026-05-06 — la route est rétrofittée
// avec audit log cluster pickup_* et rate-limit Upstash 10/min/producer
// partagés avec /api/producer/orders/validate-pickup. Tests étendus pour
// vérifier les events audit posés sur chaque branch + le 429 rate-limit.
//
// Pattern Supabase aligné sur tests/app/api/orders/[id]/cancel/route.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted env stubs ---------------------------------------------------

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// --- Hoisted mocks partagés avec les factories vi.mock -------------------

const {
  mockRevalidateTag,
  mockSendTemplate,
  mockLogPickupEvent,
  mockConsumeRateLimit,
} = vi.hoisted(() => ({
  mockRevalidateTag: vi.fn(),
  mockSendTemplate: vi.fn(),
  mockLogPickupEvent: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

vi.mock("@/lib/audit-logs/log-pickup-event", () => ({
  logPickupEvent: mockLogPickupEvent,
}));

// importOriginal pour préserver les autres helpers (getProducersSearch
// RateLimit etc.) consommés par d'autres tests partageant le worker
// vitest. Cf. docs/conventions/vitest-mocking-patterns.md (LOT 8).
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    consumeRateLimit: mockConsumeRateLimit,
    getPickupValidationRateLimit: () => ({}),
  };
});

// --- Auth mocks ----------------------------------------------------------

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

// LOT 5 — la route appelle désormais getOwnedProducerId pour récupérer
// le producerId (utilisé pour rate-limit keying + audit log metadata).
// Le helper userOwnsProducer n'est plus consommé par /complete mais
// gardé en mock no-op pour ne pas casser d'éventuels tests transverses.
let ownedProducerIdResult: string | null;
vi.mock("@/lib/auth/producerOwnership", () => ({
  getOwnedProducerId: async () => ownedProducerIdResult,
  userOwnsProducer: async () => true,
}));

// --- Supabase admin client mock ------------------------------------------

type Resp = { data?: unknown; error?: unknown; count?: number };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string; opts?: unknown }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  gteCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

const ORDER_ID = "order-1";
const PRODUCER_ID = "prod-1";
const CONSUMER_ID = "cons-1";

const DEFAULT_ORDER = {
  id: ORDER_ID,
  producer_id: PRODUCER_ID,
  consumer_id: CONSUMER_ID,
  statut: "confirmed" as string,
  code_commande: "ABC123",
};

function defaultResp(table: string, op: Op): Resp {
  if (op === "update" || op === "insert") return { data: null, error: null };
  if (table === "orders") return { data: DEFAULT_ORDER, error: null };
  if (table === "producers")
    return {
      data: { nom_exploitation: "Ferme Test" },
      error: null,
    };
  if (table === "users")
    return { data: { email: "consumer@example.com" }, error: null };
  return { data: null, error: null };
}

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return defaultResp(table, op);
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string, opts?: unknown) => {
        captured.selects.push({ table, cols, opts });
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
      builder.gte = (col: string, val: unknown) => {
        captured.gteCalls.push({ table, col, val });
        return builder;
      };
      builder.not = () => builder;
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  }),
}));

// --- Import APRÈS les mocks ----------------------------------------------

import { POST } from "@/app/api/orders/[id]/complete/route";

// --- Helpers -------------------------------------------------------------

function makeRequest(opts: {
  body?: unknown;
  bodyThrow?: boolean;
} = {}): Request {
  return {
    json: async () => {
      if (opts.bodyThrow) throw new Error("invalid json");
      return opts.body === undefined ? { code_commande: "ABC123" } : opts.body;
    },
    headers: new Headers(),
  } as unknown as Request;
}

function pushOrderSelects(...resps: Resp[]) {
  responses.orders = responses.orders ?? {};
  responses.orders.select = [...(responses.orders.select ?? []), ...resps];
}

function setOrderFetch(partial: Partial<typeof DEFAULT_ORDER>) {
  responses.orders = responses.orders ?? {};
  const rest = responses.orders.select ?? [];
  responses.orders.select = [
    { data: { ...DEFAULT_ORDER, ...partial }, error: null },
    ...rest,
  ];
}

const PARAMS = { params: { id: ORDER_ID } };

// --- Setup / teardown ----------------------------------------------------

const SESSION_USER_ID = "user-prod-owner";

beforeEach(() => {
  captured = {
    fromCalls: [],
    selects: [],
    updates: [],
    inserts: [],
    eqCalls: [],
    gteCalls: [],
  };
  responses = {};
  sessionUser = {
    id: SESSION_USER_ID,
    email: "prod@example.com",
    roles: ["producer"],
    isAdmin: false,
  };
  ownedProducerIdResult = PRODUCER_ID;
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "res_1" });
  mockRevalidateTag.mockReset();
  mockLogPickupEvent.mockReset().mockResolvedValue(undefined);
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

// --- A. Body validation (zod) --------------------------------------------

describe("A. Body validation (zod)", () => {
  it("A1 body sans code_commande → 400 Invalid body, pas de Supabase I/O", async () => {
    const res = await POST(makeRequest({ body: {} }), PARAMS);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(typeof json.error).toBe("string");
    expect(captured.fromCalls).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("A2 code_commande vide après trim → 400", async () => {
    const res = await POST(
      makeRequest({ body: { code_commande: "   " } }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    expect(captured.fromCalls).toEqual([]);
  });

  it("A3 body json throw → safeParse(null) → 400", async () => {
    const res = await POST(makeRequest({ bodyThrow: true }), PARAMS);
    expect(res.status).toBe(400);
    expect(captured.fromCalls).toEqual([]);
  });
});

// --- B. Auth -------------------------------------------------------------

describe("B. Auth", () => {
  it("B1 pas de session → 401, sortie avant tout I/O Supabase", async () => {
    sessionUser = null;
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(captured.fromCalls).toEqual([]);
  });
});

// --- C. Order lookup + idempotence ---------------------------------------

describe("C. Order lookup + idempotence", () => {
  it("C1 order ID inconnu → 404, pas d'UPDATE", async () => {
    pushOrderSelects({ data: null, error: null });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Order not found" });
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("C2 order déjà completed → 200 already, aucun UPDATE/email", async () => {
    setOrderFetch({ statut: "completed" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

// --- D. Autorisation -----------------------------------------------------

describe("D. Autorisation (getOwnedProducerId)", () => {
  it("D1 user sans producer (getOwnedProducerId null) → 403, pas de I/O orders", async () => {
    ownedProducerIdResult = null;
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(captured.updates).toEqual([]);
    // Sortie avant rate-limit + lookup orders
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
    expect(captured.fromCalls.includes("orders")).toBe(false);
  });

  it("D2 producer du user ≠ producer de l'order → 403 + audit pickup_attempt_invalid wrong_producer", async () => {
    ownedProducerIdResult = "another-producer";
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(captured.updates).toEqual([]);
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_attempt_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("wrong_producer");
  });
});

// --- E. Transition (state machine) ---------------------------------------

describe("E. Transition state machine — completed depuis confirmed (modèle 3 états)", () => {
  it("E1 statut pending + code valide → 409 InvalidOrderTransitionError", async () => {
    setOrderFetch({ statut: "pending" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("pending");
    expect(json.error).toContain("completed");
    expect(captured.updates).toEqual([]);
  });

  it("E2 statut confirmed + code valide → 200 (pickup direct, modèle 3 états)", async () => {
    setOrderFetch({ statut: "confirmed" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect(orderUpdate).toBeDefined();
    expect((orderUpdate!.payload as Record<string, unknown>).statut).toBe(
      "completed",
    );
  });

  it("E3 statut cancelled → 409", async () => {
    setOrderFetch({ statut: "cancelled" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    expect(captured.updates).toEqual([]);
  });

  it("E4 statut refunded → 409", async () => {
    setOrderFetch({ statut: "refunded" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    expect(captured.updates).toEqual([]);
  });
});

// --- F. Code commande check ---------------------------------------------

describe("F. Code commande check (case-insensitive trim)", () => {
  it("F1 statut confirmed + code mismatch → 400 Code invalide, pas d'UPDATE", async () => {
    const res = await POST(
      makeRequest({ body: { code_commande: "WRONG1" } }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Code invalide" });
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("F2 statut confirmed + code lowercase → 200 (case-insensitive)", async () => {
    const res = await POST(
      makeRequest({ body: { code_commande: "abc123" } }),
      PARAMS,
    );
    expect(res.status).toBe(200);
    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect((orderUpdate!.payload as Record<string, unknown>).statut).toBe(
      "completed",
    );
  });

  it("F3 statut confirmed + code avec espaces → 200 (trim côté zod et check)", async () => {
    const res = await POST(
      makeRequest({ body: { code_commande: "  ABC123  " } }),
      PARAMS,
    );
    expect(res.status).toBe(200);
  });

  it("F4 statut pending + code mismatch → 409 (transition checked AVANT code)", async () => {
    setOrderFetch({ statut: "pending" });
    const res = await POST(
      makeRequest({ body: { code_commande: "WRONG1" } }),
      PARAMS,
    );
    // Si l'ordre changeait (code check first), on aurait 400. La vérif
    // verrouille l'ordre actuel : statut → code.
    expect(res.status).toBe(409);
  });
});

// --- G. Cas nominal confirmed → completed --------------------------------

describe("G. Cas nominal confirmed → completed", () => {
  it("G1 confirmed + code valide → 200 + UPDATE orders { statut, completed_at }", async () => {
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; completed_at: string };
    expect(json.ok).toBe(true);
    expect(json.completed_at).toEqual(expect.any(String));
    expect(() => new Date(json.completed_at).toISOString()).not.toThrow();

    const orderUpdate = captured.updates.find((u) => u.table === "orders");
    expect(orderUpdate).toBeDefined();
    const payload = orderUpdate!.payload as Record<string, unknown>;
    expect(payload.statut).toBe("completed");
    expect(payload.completed_at).toEqual(expect.any(String));

    const idEqs = captured.eqCalls.filter(
      (e) => e.table === "orders" && e.col === "id" && e.val === ORDER_ID,
    );
    expect(idEqs.length).toBeGreaterThanOrEqual(2);
  });

  it("G2 réponse contient completed_at en ISO string", async () => {
    const res = await POST(makeRequest(), PARAMS);
    const json = (await res.json()) as { completed_at: string };
    expect(json.completed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});

// --- H. revalidateTag ----------------------------------------------------

describe("H. revalidateTag (asymétrie vs confirm/cancel)", () => {
  it("H1 revalidateTag jamais appelé en cas nominal (intentionnel : filtre IN inchangé)", async () => {
    await POST(makeRequest(), PARAMS);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });
});

// --- I. Email review_request_j0 -----------------------------------------

describe("I. Email consumer (review_request_j0)", () => {
  it("I1 nominal → sendTemplate('review_request_j0') avec to/userId/metadata", async () => {
    await POST(makeRequest(), PARAMS);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    const args = mockSendTemplate.mock.calls[0]![0] as {
      template: string;
      to: string;
      userId: string;
      metadata: Record<string, unknown>;
    };
    expect(args.template).toBe("review_request_j0");
    expect(args.to).toBe("consumer@example.com");
    expect(args.userId).toBe(CONSUMER_ID);
    expect(args.metadata.order_id).toBe(ORDER_ID);
    expect(args.metadata.code_commande).toBe("ABC123");
  });

  it("I2 reviewUrl pointe sur /compte/commandes/{id}/avis (props passées au template)", async () => {
    await POST(makeRequest(), PARAMS);
    const args = mockSendTemplate.mock.calls[0]![0] as {
      element: { props: { reviewUrl: string; dayOffset: 0 | 2 | 7 } };
    };
    expect(args.element.props.reviewUrl).toContain(
      `/compte/commandes/${ORDER_ID}/avis`,
    );
    expect(args.element.props.dayOffset).toBe(0);
  });

  it("I3 consumer.email null → sendTemplate jamais appelé, route reste 200", async () => {
    responses.users = {
      select: [{ data: { email: null }, error: null }],
    };
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("I4 producer null → sendTemplate jamais appelé, route reste 200", async () => {
    responses.producers = {
      select: [{ data: null, error: null }],
    };
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

// --- J. LOT 5 — Audit log cluster pickup_* + rate-limit ----------------

describe("J. Audit log cluster pickup_* (LOT 5)", () => {
  it("J1 nominal confirmed → audit pickup_validated avec metadata complet", async () => {
    await POST(makeRequest(), PARAMS);
    const validatedCalls = mockLogPickupEvent.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === "pickup_validated",
    );
    expect(validatedCalls).toHaveLength(1);
    const meta = (
      validatedCalls[0]![0] as {
        userId: string;
        metadata: Record<string, unknown>;
      }
    );
    expect(meta.userId).toBe(SESSION_USER_ID);
    expect(meta.metadata.producer_id).toBe(PRODUCER_ID);
    expect(meta.metadata.order_id).toBe(ORDER_ID);
    expect(meta.metadata.route).toBe("complete_id_based");
    expect(typeof meta.metadata.completed_at).toBe("string");
  });

  it("J2 already completed (idempotent) → audit pickup_attempt_invalid reason=already_completed", async () => {
    setOrderFetch({ statut: "completed" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });
    const invalidCalls = mockLogPickupEvent.mock.calls.filter(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_attempt_invalid",
    );
    expect(invalidCalls).toHaveLength(1);
    const meta = (invalidCalls[0]![0] as { metadata: Record<string, unknown> })
      .metadata;
    expect(meta.reason).toBe("already_completed");
    expect(meta.route).toBe("complete_id_based");
  });

  it("J3 assertTransition fail (pending) → audit reason=order_not_confirmed:pending", async () => {
    setOrderFetch({ statut: "pending" });
    await POST(makeRequest(), PARAMS);
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_attempt_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("order_not_confirmed:pending");
  });

  it("J4 code mismatch → audit reason=code_mismatch (et pas de UPDATE/email)", async () => {
    const res = await POST(
      makeRequest({ body: { code_commande: "WRONG1" } }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_attempt_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("code_mismatch");
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("J5 rate-limit hit → 429 + Retry-After header + audit pickup_attempt_rate_limited", async () => {
    mockConsumeRateLimit.mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 30_000,
    });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("rate_limit");
    // Sortie avant lookup orders + UPDATE + email
    expect(captured.fromCalls.includes("orders")).toBe(false);
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
    const rateLimitedCalls = mockLogPickupEvent.mock.calls.filter(
      (c) =>
        (c[0] as { eventType: string }).eventType ===
        "pickup_attempt_rate_limited",
    );
    expect(rateLimitedCalls).toHaveLength(1);
    const meta = (rateLimitedCalls[0]![0] as { metadata: Record<string, unknown> })
      .metadata;
    expect(meta.producer_id).toBe(PRODUCER_ID);
    expect(meta.route).toBe("complete_id_based");
  });

  it("J6 rate-limit success → consumeRateLimit appelé avec key producer:<id>", async () => {
    await POST(makeRequest(), PARAMS);
    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      `producer:${PRODUCER_ID}`,
    );
  });
});

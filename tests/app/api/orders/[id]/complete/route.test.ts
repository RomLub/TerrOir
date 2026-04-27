// Vitest pour POST /api/orders/[id]/complete.
// Couverture : zod body (code_commande required), auth, order lookup,
// idempotence, autorisation, state machine (assertTransition vers completed
// depuis ready only), code_commande check (case-insensitive trim), UPDATE
// orders, email review_request_j0. Pas de revalidateTag (intentionnel — la
// commande reste dans le filtre IN ('confirmed','ready','completed')).
//
// Pattern Supabase aligné sur tests/app/api/orders/[id]/cancel/route.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted env stubs ---------------------------------------------------

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3000";
});

// --- Hoisted mocks partagés avec les factories vi.mock -------------------

const { mockRevalidateTag, mockSendTemplate } = vi.hoisted(() => ({
  mockRevalidateTag: vi.fn(),
  mockSendTemplate: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mockRevalidateTag,
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

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

let userOwnsProducerResult: boolean;
vi.mock("@/lib/auth/producerOwnership", () => ({
  userOwnsProducer: async () => userOwnsProducerResult,
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
  statut: "ready" as string,
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
    id: "user-prod-owner",
    email: "prod@example.com",
    roles: ["producer"],
    isAdmin: false,
  };
  userOwnsProducerResult = true;
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "res_1" });
  mockRevalidateTag.mockReset();
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

describe("D. Autorisation (userOwnsProducer)", () => {
  it("D1 session pas owner → 403, pas d'UPDATE", async () => {
    userOwnsProducerResult = false;
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(captured.updates).toEqual([]);
  });
});

// --- E. Transition (state machine) ---------------------------------------

describe("E. Transition state machine — completed depuis ready only", () => {
  it("E1 statut pending + code valide → 409 InvalidOrderTransitionError", async () => {
    setOrderFetch({ statut: "pending" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("pending");
    expect(json.error).toContain("completed");
    expect(captured.updates).toEqual([]);
  });

  it("E2 statut confirmed + code valide → 409", async () => {
    setOrderFetch({ statut: "confirmed" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    expect(captured.updates).toEqual([]);
  });

  it("E3 statut cancelled → 409", async () => {
    setOrderFetch({ statut: "cancelled" });
    const res = await POST(makeRequest(), PARAMS);
    expect(res.status).toBe(409);
    expect(captured.updates).toEqual([]);
  });
});

// --- F. Code commande check ---------------------------------------------

describe("F. Code commande check (case-insensitive trim)", () => {
  it("F1 statut ready + code mismatch → 400 Code invalide, pas d'UPDATE", async () => {
    const res = await POST(
      makeRequest({ body: { code_commande: "WRONG1" } }),
      PARAMS,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Code invalide" });
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("F2 statut ready + code lowercase → 200 (case-insensitive)", async () => {
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

  it("F3 statut ready + code avec espaces → 200 (trim côté zod et check)", async () => {
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

// --- G. Cas nominal ready → completed ------------------------------------

describe("G. Cas nominal ready → completed", () => {
  it("G1 ready + code valide → 200 + UPDATE orders { statut, completed_at }", async () => {
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

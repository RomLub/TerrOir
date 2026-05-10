// Tests intégration end-to-end pickup-validation (LOT 7 chantier
// pickup-validation 2026-05-06).
//
// Différence vs route.test.ts (LOT 3) qui mocke les helpers pickup-
// validation : ici on teste la composition réelle route + helper +
// audit log + email helper. Seuls sont mockés :
//   - @/lib/auth/session + @/lib/auth/producerOwnership
//   - @/lib/supabase/admin (mock builder queue par-table)
//   - @/lib/rate-limit (importOriginal pattern)
//   - @/lib/resend/send (sendTemplate mocké)
//
// Les helpers @/lib/orders/pickup-validation, @/lib/orders/send-pickup-
// review-email et @/lib/audit-logs/log-pickup-event tournent en réel,
// permettant de vérifier le pipeline complet :
//   route → helper validate → UPDATE atomic → audit insert → email send
//
// Couvre :
//   1. Flow nominal complet POST → 200 + UPDATE + audit + email
//   2. Producer A code de B → 404 générique + audit reason=wrong_producer
//   3. Code commande pending → 409 + detail_url + audit
//   4. Déjà completed → 409 + completed_at préservé + audit
//   5. Rate-limit hit → 429 + Retry-After + audit
//   6. Race : UPDATE atomic 0 rows → re-fetch → already_completed

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// --- Mocks externes (auth + Resend + rate-limit) -----------------------

const { mockSendTemplate, mockConsumeRateLimit } = vi.hoisted(() => ({
  mockSendTemplate: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
}));

vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    consumeRateLimit: mockConsumeRateLimit,
    getPickupValidationRateLimit: () => ({}),
  };
});

let sessionUserId: string | null;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () =>
    sessionUserId
      ? { id: sessionUserId, email: "p@test.fr", roles: ["producer"], isAdmin: false }
      : null,
}));

let ownedProducerIdResult: string | null;
vi.mock("@/lib/auth/producerOwnership", () => ({
  getOwnedProducerId: async () => ownedProducerIdResult,
  userOwnsProducer: async () => true,
}));

// --- Mock Supabase admin client : queue par-table + capture ------------

type ChainResp = { data?: unknown; error?: unknown };

interface Captured {
  from: string[];
  selectCols: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  rpcCalls: Array<{ name: string; params: unknown }>;
}

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", ChainResp[]>>
> & { rpc?: Record<string, ChainResp[]> };

function defaultResp(table: string, op: string): ChainResp {
  if (op === "update" || op === "insert") return { data: null, error: null };
  if (table === "users")
    return { data: { email: "consumer@test.fr" }, error: null };
  if (table === "producers")
    return { data: { nom_exploitation: "Ferme Test" }, error: null };
  return { data: null, error: null };
}

function consume(table: string, op: "select" | "update" | "insert"): ChainResp {
  const queue = responses[table]?.[op];
  if (queue && queue.length > 0) return queue.shift()!;
  return defaultResp(table, op);
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.from.push(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = { _op: "select" };
      builder.select = (cols: string) => {
        captured.selectCols.push({ table, cols });
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
        return Promise.resolve({ data: null, error: null });
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve(consume(table, builder._op as "select" | "update"));
      builder.then = (onFulfilled: (r: ChainResp) => unknown) =>
        onFulfilled(consume(table, builder._op as "select" | "update"));
      return builder;
    },
    rpc: (name: string, params: unknown) => {
      captured.rpcCalls.push({ name, params });
      const queue = responses.rpc?.[name];
      if (queue && queue.length > 0) return Promise.resolve(queue.shift()!);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

// --- Imports APRÈS mocks -----------------------------------------------

import {
  GET,
  POST,
} from "@/app/api/producer/orders/validate-pickup/route";

// --- Constantes + fixtures --------------------------------------------

const USER_ID = "user-prod-1";
const PRODUCER_ID = "prod-1";
const OTHER_PRODUCER_ID = "prod-other";
const ORDER_ID = "order-1";
const CONSUMER_ID = "cons-1";
const CODE = "TRR-ABCDE";

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    code_commande: CODE,
    producer_id: PRODUCER_ID,
    consumer_id: CONSUMER_ID,
    statut: "confirmed",
    montant_total: "25.00",
    completed_at: null,
    created_at: "2026-05-06T10:00:00Z",
    consumer: { prenom: "Marie", nom: "Dupont" },
    order_items: [
      {
        quantite: "1",
        prix_unitaire: "25.00",
        sous_total: "25.00",
        products: { nom: "Côte de bœuf", unite: "kg" },
      },
    ],
    ...overrides,
  };
}

function makePostRequest(body: unknown = { code: CODE }): Request {
  return {
    json: async () => body,
    headers: new Headers(),
    method: "POST",
  } as unknown as Request;
}

function makeGetRequest(code: string = CODE): Request {
  return new Request(
    `http://localhost/api/producer/orders/validate-pickup?code=${encodeURIComponent(code)}`,
    { method: "GET" },
  );
}

// --- Setup --------------------------------------------------------------

beforeEach(() => {
  captured = {
    from: [],
    selectCols: [],
    updates: [],
    inserts: [],
    eqCalls: [],
    rpcCalls: [],
  };
  responses = {};
  sessionUserId = USER_ID;
  ownedProducerIdResult = PRODUCER_ID;
  mockSendTemplate.mockReset().mockResolvedValue({ ok: true, id: "email-id" });
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

// --- 1. Flow nominal complet -------------------------------------------

describe("Intégration e2e — flow nominal pickup", () => {
  it("1.1 confirmed + code valide POST → 200 + UPDATE + audit_logs insert + email envoyé", async () => {
    const orderRow = makeOrderRow();
    const completedRow = makeOrderRow({
      statut: "completed",
      completed_at: "2026-05-06T11:00:00Z",
    });
    responses.orders = {
      select: [
        { data: orderRow, error: null }, // SELECT lookup
        { data: completedRow, error: null }, // UPDATE returning
      ],
    };

    const res = await POST(makePostRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order: { id: string; status: string; completed_at: string };
    };
    expect(body.order.status).toBe("completed");
    expect(body.order.completed_at).toBeTruthy();

    // F-001 P0-TA : transition + UPDATE atomique + audit log SQL-side via
    // RPC SECDEF complete_pickup_by_producer (cf migration F-001).
    expect(captured.rpcCalls).toContainEqual(
      expect.objectContaining({
        name: "complete_pickup_by_producer",
        params: expect.objectContaining({ p_order_id: ORDER_ID }),
      }),
    );
    expect(captured.updates.find((u) => u.table === "orders")).toBeUndefined();

    // audit_logs `pickup_validated` posé SQL-side par la RPC dans la même
    // transaction. Pas observable depuis le mock vitest. Le caller route
    // ne pose pas l'audit côté JS pour éviter le double log.

    // sendTemplate appelé pour review_request_j0
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    const tplCall = mockSendTemplate.mock.calls[0]?.[0] as {
      template: string;
      to: string;
      userId: string;
    };
    expect(tplCall.template).toBe("review_request_j0");
    expect(tplCall.to).toBe("consumer@test.fr");
    expect(tplCall.userId).toBe(CONSUMER_ID);
  });
});

// --- 2. Edge cases -----------------------------------------------------

describe("Intégration e2e — edge cases", () => {
  it("2.1 Producer A tente code de Producer B → 404 GÉNÉRIQUE + audit reason=wrong_producer", async () => {
    const orderRow = makeOrderRow({ producer_id: OTHER_PRODUCER_ID });
    responses.orders = {
      select: [{ data: orderRow, error: null }],
    };

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "pickup_code_unknown" });

    // Audit log distingue wrong_producer en interne (anti-info-leakage)
    const previewInvalid = captured.inserts.find(
      (i) =>
        (i.payload as Record<string, unknown>).event_type ===
        "pickup_preview_invalid",
    );
    expect(previewInvalid).toBeDefined();
    const meta = (previewInvalid!.payload as Record<string, unknown>)
      .metadata as Record<string, unknown>;
    expect(meta.reason).toBe("wrong_producer");

    // Pas d'UPDATE ni d'email
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("2.2 Code commande pending → 409 + detail_url + audit reason=order_not_confirmed:pending", async () => {
    const orderRow = makeOrderRow({ statut: "pending" });
    responses.orders = {
      select: [{ data: orderRow, error: null }],
    };

    const res = await POST(makePostRequest());
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      current_status: string;
      detail_url: string;
    };
    expect(body.error).toBe("pickup_order_not_confirmed");
    expect(body.current_status).toBe("pending");
    expect(body.detail_url).toContain(`/commandes/${ORDER_ID}`);

    const auditInsert = captured.inserts.find(
      (i) =>
        (i.payload as Record<string, unknown>).event_type ===
        "pickup_attempt_invalid",
    );
    expect(auditInsert).toBeDefined();
    const meta = (auditInsert!.payload as Record<string, unknown>)
      .metadata as Record<string, unknown>;
    expect(meta.reason).toBe("order_not_confirmed:pending");

    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("2.3 Déjà completed → 409 + completed_at originale préservée", async () => {
    const completedAt = "2026-05-05T14:00:00Z";
    const orderRow = makeOrderRow({
      statut: "completed",
      completed_at: completedAt,
    });
    responses.orders = {
      select: [{ data: orderRow, error: null }],
    };

    const res = await POST(makePostRequest());
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      completed_at: string;
    };
    expect(body.error).toBe("pickup_already_completed");
    expect(body.completed_at).toBe(completedAt);

    const auditInsert = captured.inserts.find(
      (i) =>
        (i.payload as Record<string, unknown>).event_type ===
        "pickup_attempt_invalid",
    );
    const meta = (auditInsert!.payload as Record<string, unknown>)
      .metadata as Record<string, unknown>;
    expect(meta.reason).toBe("order_already_completed");

    // Pas de re-UPDATE ni email (idempotent côté code-based)
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("2.4 Rate-limit hit (cumulé tentatives répétées) → 429 + Retry-After + audit", async () => {
    mockConsumeRateLimit.mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 30_000,
    });

    const res = await POST(makePostRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = (await res.json()) as {
      error: string;
      retry_after_seconds: number;
    };
    expect(body.error).toBe("rate_limit");
    expect(body.retry_after_seconds).toBeGreaterThan(0);

    // Sortie avant lookup orders + UPDATE + email
    expect(captured.from.includes("orders")).toBe(false);
    expect(captured.updates).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();

    // Audit pickup_attempt_rate_limited posé
    const auditInsert = captured.inserts.find(
      (i) =>
        (i.payload as Record<string, unknown>).event_type ===
        "pickup_attempt_rate_limited",
    );
    expect(auditInsert).toBeDefined();
  });

  it("2.5 Race condition : RPC P0001 → re-fetch caractérise already_completed (F-001 P0-TA)", async () => {
    const orderRow = makeOrderRow();
    const refetchRow = {
      id: ORDER_ID,
      statut: "completed",
      completed_at: "2026-05-06T11:30:00Z",
    };
    responses.orders = {
      select: [
        { data: orderRow, error: null }, // 1er SELECT lookup → confirmed
        { data: refetchRow, error: null }, // re-fetch post-P0001 → completed
      ],
    };
    responses.rpc = {
      complete_pickup_by_producer: [
        {
          data: null,
          error: { code: "P0001", message: "illegal_transition" },
        },
      ],
    };

    const res = await POST(makePostRequest());
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      completed_at: string;
    };
    expect(body.error).toBe("pickup_already_completed");
    expect(body.completed_at).toBe(refetchRow.completed_at);

    // F-001 P0-TA : RPC complete_pickup_by_producer appelée.
    expect(captured.rpcCalls).toContainEqual(
      expect.objectContaining({ name: "complete_pickup_by_producer" }),
    );

    // Pas d'email (la transition n'a pas eu lieu côté nous)
    expect(mockSendTemplate).not.toHaveBeenCalled();

    // Audit log invalid posé pour le résultat
    const auditInsert = captured.inserts.find(
      (i) =>
        (i.payload as Record<string, unknown>).event_type ===
        "pickup_attempt_invalid",
    );
    expect(auditInsert).toBeDefined();
    const meta = (auditInsert!.payload as Record<string, unknown>)
      .metadata as Record<string, unknown>;
    expect(meta.reason).toBe("order_already_completed");
  });

  it("2.6 Code mal formaté → 400 invalid_code_format sans I/O Supabase", async () => {
    const res = await POST(makePostRequest({ code: "WRONG" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code_format" });
    // Pas de lookup orders (helper validatePickup s'arrête sur Zod)
    expect(captured.from.includes("orders")).toBe(false);
    expect(captured.updates).toEqual([]);
  });
});

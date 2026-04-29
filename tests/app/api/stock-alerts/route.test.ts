// Tests vitest pour POST /api/stock-alerts.
//
// Stratégie : mock de createStockAlert + sendTemplate + getSessionUser +
// createSupabaseAdminClient. Le mock client gère SELECT product/producer
// + SELECT rate limit count.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

vi.mock("server-only", () => ({}));

const {
  mockGetSessionUser,
  mockCreateStockAlert,
  mockSendTemplate,
  mockClientHolder,
} = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
  mockCreateStockAlert: vi.fn(),
  mockSendTemplate: vi.fn(),
  mockClientHolder: { current: null as SupabaseClient | null },
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: mockGetSessionUser,
}));
vi.mock("@/lib/stock-alerts/create-alert", () => ({
  createStockAlert: mockCreateStockAlert,
}));
vi.mock("@/lib/resend/send", () => ({
  sendTemplate: mockSendTemplate,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockClientHolder.current!,
}));

import { POST } from "@/app/api/stock-alerts/route";

type Resp = { data?: unknown; error?: unknown };
type Op = "select" | "update" | "insert" | "pending";

type Captured = {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  gteCalls: Array<{ table: string; col: string; val: unknown }>;
};

let captured: Captured;
let responses: Record<
  string,
  Partial<Record<"select" | "update" | "insert", Resp[]>>
>;

function consume(table: string, op: Op): Resp {
  if (op !== "pending") {
    const queue = responses[table]?.[op];
    if (queue && queue.length > 0) return queue.shift()!;
  }
  return { data: null, error: null };
}

function pushResp(table: string, op: "select", ...resps: Resp[]) {
  responses[table] = responses[table] ?? {};
  responses[table][op] = [...(responses[table][op] ?? []), ...resps];
}

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => {
      captured.fromCalls.push(table);
      const builder: Record<string, unknown> & { _op: Op } = { _op: "pending" };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        if (builder._op === "pending") builder._op = "select";
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
      builder.maybeSingle = () =>
        Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: Resp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  } as unknown as SupabaseClient;
}

const PRODUCT_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCER_ID = "22222222-2222-2222-2222-222222222222";
const ALERT_ID = "33333333-3333-3333-3333-333333333333";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = { fromCalls: [], selects: [], eqCalls: [], gteCalls: [] };
  responses = {};
  mockGetSessionUser.mockReset();
  mockCreateStockAlert.mockReset();
  mockSendTemplate.mockReset();
  mockClientHolder.current = buildMockClient();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  // Default: anon
  mockGetSessionUser.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/stock-alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function defaultProductIndispoOk() {
  // Produit indispo : active=true, stock_illimite=false, stock_disponible=0.
  pushResp("products", "select", {
    data: {
      id: PRODUCT_ID,
      active: true,
      stock_disponible: 0,
      stock_illimite: false,
      nom: "Faux-filet",
      producer_id: PRODUCER_ID,
    },
    error: null,
  });
}

function defaultProducerSlugOk() {
  pushResp("producers", "select", {
    data: { slug: "ferme-foo" },
    error: null,
  });
}

function defaultRateLimitOk() {
  // 0 alertes récentes pour cet email → pas de rate limit hit.
  pushResp("product_stock_alerts", "select", { data: [], error: null });
}

describe("POST /api/stock-alerts — validation Zod", () => {
  it("body absent → 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/stock-alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("consent absent → 400 (consentement RGPD obligatoire)", async () => {
    const res = await POST(
      makeRequest({ product_id: PRODUCT_ID, email: "x@y.com" }),
    );
    expect(res.status).toBe(400);
  });

  it("consent=false → 400", async () => {
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: false,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("email invalide → 400", async () => {
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "not-an-email",
        consent: true,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("product_id non-uuid → 400", async () => {
    const res = await POST(
      makeRequest({
        product_id: "not-a-uuid",
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/stock-alerts — validation business", () => {
  it("produit introuvable → 404", async () => {
    pushResp("products", "select", { data: null, error: null });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(404);
    expect(mockCreateStockAlert).not.toHaveBeenCalled();
  });

  it("erreur DB sur fetch product → 500 + console.error", async () => {
    pushResp("products", "select", {
      data: null,
      error: { message: "db down" },
    });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("produit active=false → 400 (pas dispo à la vente)", async () => {
    pushResp("products", "select", {
      data: {
        id: PRODUCT_ID,
        active: false,
        stock_disponible: 0,
        stock_illimite: false,
        nom: "X",
        producer_id: PRODUCER_ID,
      },
      error: null,
    });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(mockCreateStockAlert).not.toHaveBeenCalled();
  });

  it("produit stock_illimite=true → 400 (jamais indispo)", async () => {
    pushResp("products", "select", {
      data: {
        id: PRODUCT_ID,
        active: true,
        stock_disponible: 0,
        stock_illimite: true,
        nom: "X",
        producer_id: PRODUCER_ID,
      },
      error: null,
    });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("produit stock_disponible > 0 → 400 (déjà en stock)", async () => {
    pushResp("products", "select", {
      data: {
        id: PRODUCT_ID,
        active: true,
        stock_disponible: 5,
        stock_illimite: false,
        nom: "X",
        producer_id: PRODUCER_ID,
      },
      error: null,
    });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/stock-alerts — rate limit", () => {
  it("10 alertes récentes pour cet email → 429", async () => {
    defaultProductIndispoOk();
    // 10 alertes existantes dans la dernière heure
    pushResp("product_stock_alerts", "select", {
      data: new Array(10).fill({ id: "x" }),
      error: null,
    });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "spammer@example.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(429);
    expect(mockCreateStockAlert).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it("9 alertes récentes → passe (< 10)", async () => {
    defaultProductIndispoOk();
    pushResp("product_stock_alerts", "select", {
      data: new Array(9).fill({ id: "x" }),
      error: null,
    });
    defaultProducerSlugOk();
    mockCreateStockAlert.mockResolvedValueOnce({
      ok: true,
      data: {
        id: ALERT_ID,
        already_active: false,
        confirm_token: "CT",
        unsubscribe_token: "UT",
      },
    });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "r1" });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockCreateStockAlert).toHaveBeenCalled();
  });

  it("erreur count rate limit → continue (best-effort), pas de 429", async () => {
    defaultProductIndispoOk();
    pushResp("product_stock_alerts", "select", {
      data: null,
      error: { message: "count failed" },
    });
    defaultProducerSlugOk();
    mockCreateStockAlert.mockResolvedValueOnce({
      ok: true,
      data: {
        id: ALERT_ID,
        already_active: false,
        confirm_token: "CT",
        unsubscribe_token: "UT",
      },
    });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "r1" });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("POST /api/stock-alerts — création + envoi email", () => {
  it("createStockAlert ok + sendTemplate ok → 200 status:created", async () => {
    defaultProductIndispoOk();
    defaultRateLimitOk();
    defaultProducerSlugOk();
    mockCreateStockAlert.mockResolvedValueOnce({
      ok: true,
      data: {
        id: ALERT_ID,
        already_active: false,
        confirm_token: "CT",
        unsubscribe_token: "UT",
      },
    });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "r1" });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "created" });

    // sendTemplate appelé avec props correctes (URLs construites)
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    const args = mockSendTemplate.mock.calls[0][0];
    expect(args.to).toBe("x@y.com");
    expect(args.template).toBe("stock-alert-confirm");
    expect(args.metadata).toEqual({
      product_id: PRODUCT_ID,
      alert_id: ALERT_ID,
    });
    const element = args.element as { props: Record<string, unknown> };
    expect(element.props.productName).toBe("Faux-filet");
    expect(element.props.confirmUrl).toBe(
      `http://localhost:3000/api/stock-alerts/confirm?token=CT`,
    );
    expect(element.props.unsubscribeUrl).toBe(
      `http://localhost:3000/api/stock-alerts/unsubscribe?token=UT`,
    );
    expect(element.props.productUrl).toBe(
      `http://localhost:3000/producteurs/ferme-foo/produits/${PRODUCT_ID}`,
    );
  });

  it("createStockAlert ok + already_active → 200 status:already_active, pas d'email", async () => {
    defaultProductIndispoOk();
    defaultRateLimitOk();
    mockCreateStockAlert.mockResolvedValueOnce({
      ok: true,
      data: {
        id: ALERT_ID,
        already_active: true,
        confirm_token: null,
        unsubscribe_token: null,
      },
    });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "already_active" });
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("createStockAlert ok + sendTemplate fail → 200 (l'alerte est créée, on log l'erreur send)", async () => {
    defaultProductIndispoOk();
    defaultRateLimitOk();
    defaultProducerSlugOk();
    mockCreateStockAlert.mockResolvedValueOnce({
      ok: true,
      data: {
        id: ALERT_ID,
        already_active: false,
        confirm_token: "CT",
        unsubscribe_token: "UT",
      },
    });
    mockSendTemplate.mockResolvedValueOnce({ ok: false, error: "rate" });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("createStockAlert ok:false → 500", async () => {
    defaultProductIndispoOk();
    defaultRateLimitOk();
    mockCreateStockAlert.mockResolvedValueOnce({
      ok: false,
      error: "db fail",
    });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(500);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  it("session connectée → consumer_id propagé au helper + sendTemplate", async () => {
    defaultProductIndispoOk();
    defaultRateLimitOk();
    defaultProducerSlugOk();
    mockGetSessionUser.mockResolvedValueOnce({
      id: "user-uuid-abc",
      email: "user@example.com",
      roles: [],
      isAdmin: false,
    });
    mockCreateStockAlert.mockResolvedValueOnce({
      ok: true,
      data: {
        id: ALERT_ID,
        already_active: false,
        confirm_token: "CT",
        unsubscribe_token: "UT",
      },
    });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "r1" });
    const res = await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockCreateStockAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ consumer_id: "user-uuid-abc" }),
    );
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-uuid-abc" }),
    );
  });

  it("session anon → consumer_id null", async () => {
    defaultProductIndispoOk();
    defaultRateLimitOk();
    defaultProducerSlugOk();
    mockCreateStockAlert.mockResolvedValueOnce({
      ok: true,
      data: {
        id: ALERT_ID,
        already_active: false,
        confirm_token: "CT",
        unsubscribe_token: "UT",
      },
    });
    mockSendTemplate.mockResolvedValueOnce({ ok: true, id: "r1" });
    await POST(
      makeRequest({
        product_id: PRODUCT_ID,
        email: "x@y.com",
        consent: true,
      }),
    );
    expect(mockCreateStockAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ consumer_id: null }),
    );
  });
});

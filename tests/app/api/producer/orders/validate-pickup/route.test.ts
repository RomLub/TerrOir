// Tests vitest pour /api/producer/orders/validate-pickup (LOT 3 chantier
// pickup-validation 2026-05-06).
//
// Stratégie :
//   - Mock pickup-validation helpers (previewPickup, validatePickup) pour
//     contrôler le résultat sans rejouer la chaîne Supabase complète. Les
//     internals helper sont déjà testés en
//     tests/lib/orders/pickup-validation.test.ts (35 cas).
//   - Mock auth/session + producerOwnership pour simuler un producer
//     authentifié.
//   - Mock rate-limit (consumeRateLimit configurable success/fail).
//   - Mock log-pickup-event pour capturer les events émis par la route.
//   - Mock send-pickup-review-email pour vérifier l'envoi sur path POST
//     succès.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted env stubs ---------------------------------------------------

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// --- Hoisted mocks -------------------------------------------------------

const {
  mockPreviewPickup,
  mockValidatePickup,
  mockConsumeRateLimit,
  mockLogPickupEvent,
  mockSendPickupReviewEmail,
} = vi.hoisted(() => ({
  mockPreviewPickup: vi.fn(),
  mockValidatePickup: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockLogPickupEvent: vi.fn(),
  mockSendPickupReviewEmail: vi.fn(),
}));

vi.mock("@/lib/orders/pickup-validation", () => ({
  previewPickup: mockPreviewPickup,
  validatePickup: mockValidatePickup,
}));

// importOriginal pour préserver les autres helpers (getProducersSearchRateLimit
// etc.) consommés par d'autres tests partageant le worker vitest. Sans ce
// merge, le mock écrase tout le module et casse les tests transverses.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    consumeRateLimit: mockConsumeRateLimit,
    getPickupValidationRateLimit: () => ({}),
  };
});

vi.mock("@/lib/audit-logs/log-pickup-event", () => ({
  logPickupEvent: mockLogPickupEvent,
}));

vi.mock("@/lib/orders/send-pickup-review-email", () => ({
  sendPickupReviewEmail: mockSendPickupReviewEmail,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

// --- Auth mocks ----------------------------------------------------------

type SessionUser = { id: string; email: string | null } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

let ownedProducerId: string | null;
vi.mock("@/lib/auth/producerOwnership", () => ({
  getOwnedProducerId: async () => ownedProducerId,
}));

// --- Import APRÈS mocks --------------------------------------------------

import {
  GET,
  POST,
} from "@/app/api/producer/orders/validate-pickup/route";

// --- Helpers -------------------------------------------------------------

const USER_ID = "user-prod-1";
const PRODUCER_ID = "prod-1";
const ORDER_ID = "order-1";
const CONSUMER_ID = "cons-1";
const CODE = "TRR-ABCDE";

function makeGet(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/producer/orders/validate-pickup");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, { method: "GET" });
}

function makePost(opts: {
  body?: unknown;
  bodyThrow?: boolean;
} = {}): Request {
  return {
    json: async () => {
      if (opts.bodyThrow) throw new Error("invalid json");
      return opts.body === undefined ? { code: CODE } : opts.body;
    },
    headers: new Headers(),
    method: "POST",
  } as unknown as Request;
}

const samplePreview = {
  id: ORDER_ID,
  code_commande: CODE,
  consumer_id: CONSUMER_ID,
  consumer_name: "Marie Dupont",
  items: [{ name: "Saucisson", qty: "1,00 pièce", unit_price: 8, total: 8 }],
  total_amount: 8,
  status: "confirmed" as const,
  created_at: "2026-05-06T10:00:00Z",
};

const sampleValidated = {
  ...samplePreview,
  status: "completed" as const,
  completed_at: "2026-05-06T11:00:00Z",
};

// --- Setup ---------------------------------------------------------------

beforeEach(() => {
  sessionUser = { id: USER_ID, email: "prod@example.com" };
  ownedProducerId = PRODUCER_ID;
  mockPreviewPickup.mockReset();
  mockValidatePickup.mockReset();
  mockConsumeRateLimit.mockReset().mockResolvedValue({
    success: true,
    limit: 10,
    remaining: 9,
    reset: Date.now() + 60_000,
  });
  mockLogPickupEvent.mockReset().mockResolvedValue(undefined);
  mockSendPickupReviewEmail
    .mockReset()
    .mockResolvedValue({ ok: true, sent: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- A. Auth -------------------------------------------------------------

describe("A. Auth (GET + POST)", () => {
  it("A1 GET sans session → 401, pas de helper appelé", async () => {
    sessionUser = null;
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(401);
    expect(mockPreviewPickup).not.toHaveBeenCalled();
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });

  it("A2 POST sans session → 401", async () => {
    sessionUser = null;
    const res = await POST(makePost());
    expect(res.status).toBe(401);
    expect(mockValidatePickup).not.toHaveBeenCalled();
  });

  it("A3 session sans producer (getOwnedProducerId null) → 403", async () => {
    ownedProducerId = null;
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(403);
    expect(mockPreviewPickup).not.toHaveBeenCalled();
  });
});

// --- B. Rate-limit -------------------------------------------------------

describe("B. Rate-limit (10/min/producer)", () => {
  it("B1 GET allowed → helper appelé normalement", async () => {
    mockPreviewPickup.mockResolvedValue({ ok: true, order: samplePreview });
    await GET(makeGet({ code: CODE }));
    expect(mockConsumeRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      `producer:${PRODUCER_ID}`,
    );
    expect(mockPreviewPickup).toHaveBeenCalled();
  });

  it("B2 GET blocked → 429 + Retry-After header + audit pickup_attempt_rate_limited", async () => {
    const reset = Date.now() + 30_000;
    mockConsumeRateLimit.mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset,
    });
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("rate_limit");
    expect(mockPreviewPickup).not.toHaveBeenCalled();

    const rateLimitedCalls = mockLogPickupEvent.mock.calls.filter(
      (c) =>
        (c[0] as { eventType: string }).eventType ===
        "pickup_attempt_rate_limited",
    );
    expect(rateLimitedCalls).toHaveLength(1);
    const meta = (rateLimitedCalls[0]![0] as { metadata: Record<string, unknown> })
      .metadata;
    expect(meta.method).toBe("GET");
    expect(meta.producer_id).toBe(PRODUCER_ID);
  });

  it("B3 POST blocked → 429 + audit method=POST", async () => {
    mockConsumeRateLimit.mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    const res = await POST(makePost());
    expect(res.status).toBe(429);
    expect(mockValidatePickup).not.toHaveBeenCalled();
    const auditCalls = mockLogPickupEvent.mock.calls.filter(
      (c) =>
        (c[0] as { eventType: string }).eventType ===
        "pickup_attempt_rate_limited",
    );
    const meta = (auditCalls[0]![0] as { metadata: Record<string, unknown> })
      .metadata;
    expect(meta.method).toBe("POST");
  });
});

// --- C. GET preview ------------------------------------------------------

describe("C. GET preview", () => {
  it("C1 succès → 200 + preview complet + audit pickup_preview_ok", async () => {
    mockPreviewPickup.mockResolvedValue({ ok: true, order: samplePreview });
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: typeof samplePreview };
    expect(body.order.id).toBe(ORDER_ID);
    expect(body.order.consumer_name).toBe("Marie Dupont");
    expect(body.order.code_commande).toBe(CODE);
    expect(body.order.items).toHaveLength(1);

    const okCalls = mockLogPickupEvent.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === "pickup_preview_ok",
    );
    expect(okCalls).toHaveLength(1);
    const meta = (okCalls[0]![0] as { metadata: Record<string, unknown> })
      .metadata;
    expect(meta.order_id).toBe(ORDER_ID);
    expect(meta.producer_id).toBe(PRODUCER_ID);
  });

  it("C2 code_format_invalid → 400 invalid_code_format + audit reason=code_format_invalid", async () => {
    mockPreviewPickup.mockResolvedValue({
      ok: false,
      error: { kind: "code_format_invalid" },
    });
    const res = await GET(makeGet({ code: "WRONG" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code_format" });
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_preview_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("code_format_invalid");
  });

  it("C3 code_unknown → 404 pickup_code_unknown + audit reason=code_unknown", async () => {
    mockPreviewPickup.mockResolvedValue({
      ok: false,
      error: { kind: "code_unknown" },
    });
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "pickup_code_unknown" });
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_preview_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("code_unknown");
  });

  it("C4 wrong_producer → 404 GÉNÉRIQUE (anti-info-leakage) MAIS audit reason=wrong_producer en interne", async () => {
    mockPreviewPickup.mockResolvedValue({
      ok: false,
      error: { kind: "wrong_producer" },
    });
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(404);
    // Surface API : indistinguable de code_unknown (anti-info-leakage)
    expect(await res.json()).toEqual({ error: "pickup_code_unknown" });
    // Audit interne : distinction préservée
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_preview_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("wrong_producer");
  });

  it("C5 order_not_confirmed pending → 409 + current_status + detail_url", async () => {
    mockPreviewPickup.mockResolvedValue({
      ok: false,
      error: {
        kind: "order_not_confirmed",
        current_status: "pending",
        order_id: ORDER_ID,
      },
    });
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      current_status: string;
      detail_url: string;
    };
    expect(body.error).toBe("pickup_order_not_confirmed");
    expect(body.current_status).toBe("pending");
    expect(body.detail_url).toContain(`/commandes/${ORDER_ID}`);
  });

  it("C6 order_already_completed → 409 + completed_at préservé", async () => {
    const completedAt = "2026-05-05T14:00:00Z";
    mockPreviewPickup.mockResolvedValue({
      ok: false,
      error: {
        kind: "order_already_completed",
        completed_at: completedAt,
        order_id: ORDER_ID,
      },
    });
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      completed_at: string;
    };
    expect(body.error).toBe("pickup_already_completed");
    expect(body.completed_at).toBe(completedAt);
  });

  it("C7 order_cancelled → 409 pickup_order_cancelled", async () => {
    mockPreviewPickup.mockResolvedValue({
      ok: false,
      error: { kind: "order_cancelled", order_id: ORDER_ID },
    });
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "pickup_order_cancelled" });
  });

  it("C8 order_refunded → 409 pickup_order_refunded", async () => {
    mockPreviewPickup.mockResolvedValue({
      ok: false,
      error: { kind: "order_refunded", order_id: ORDER_ID },
    });
    const res = await GET(makeGet({ code: CODE }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "pickup_order_refunded" });
  });

  it("C9 code absent en query → previewPickup invoqué avec '' → format_invalid mock", async () => {
    mockPreviewPickup.mockResolvedValue({
      ok: false,
      error: { kind: "code_format_invalid" },
    });
    const res = await GET(makeGet());
    expect(res.status).toBe(400);
    expect(mockPreviewPickup).toHaveBeenCalledWith(
      expect.anything(),
      "",
      PRODUCER_ID,
    );
  });
});

// --- D. POST validate ----------------------------------------------------

describe("D. POST validate", () => {
  it("D1 succès → 200 + audit pickup_validated + email envoyé", async () => {
    mockValidatePickup.mockResolvedValue({ ok: true, order: sampleValidated });
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: typeof sampleValidated };
    expect(body.order.status).toBe("completed");
    expect(body.order.completed_at).toBe(sampleValidated.completed_at);

    const validatedCalls = mockLogPickupEvent.mock.calls.filter(
      (c) => (c[0] as { eventType: string }).eventType === "pickup_validated",
    );
    expect(validatedCalls).toHaveLength(1);

    expect(mockSendPickupReviewEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendPickupReviewEmail.mock.calls[0]![1] as {
      orderId: string;
      consumerId: string;
      producerId: string;
      codeCommande: string;
    };
    expect(emailArgs.orderId).toBe(ORDER_ID);
    expect(emailArgs.consumerId).toBe(CONSUMER_ID);
    expect(emailArgs.producerId).toBe(PRODUCER_ID);
    expect(emailArgs.codeCommande).toBe(CODE);
  });

  it("D2 body sans code → 400 (zod), pas de helper appelé", async () => {
    const res = await POST(makePost({ body: {} }));
    expect(res.status).toBe(400);
    expect(mockValidatePickup).not.toHaveBeenCalled();
    expect(mockSendPickupReviewEmail).not.toHaveBeenCalled();
  });

  it("D3 body throw → 400", async () => {
    const res = await POST(makePost({ bodyThrow: true }));
    expect(res.status).toBe(400);
    expect(mockValidatePickup).not.toHaveBeenCalled();
  });

  it("D4 code_unknown → 404 générique + audit reason=code_unknown, pas d'email", async () => {
    mockValidatePickup.mockResolvedValue({
      ok: false,
      error: { kind: "code_unknown" },
    });
    const res = await POST(makePost());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "pickup_code_unknown" });
    expect(mockSendPickupReviewEmail).not.toHaveBeenCalled();
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_attempt_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("code_unknown");
  });

  it("D5 wrong_producer → 404 générique + audit reason=wrong_producer (interne)", async () => {
    mockValidatePickup.mockResolvedValue({
      ok: false,
      error: { kind: "wrong_producer" },
    });
    const res = await POST(makePost());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "pickup_code_unknown" });
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_attempt_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("wrong_producer");
  });

  it("D6 order_not_confirmed pending → 409 + detail_url + audit reason avec status", async () => {
    mockValidatePickup.mockResolvedValue({
      ok: false,
      error: {
        kind: "order_not_confirmed",
        current_status: "pending",
        order_id: ORDER_ID,
      },
    });
    const res = await POST(makePost());
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      current_status: string;
      detail_url: string;
    };
    expect(body.error).toBe("pickup_order_not_confirmed");
    expect(body.current_status).toBe("pending");
    expect(body.detail_url).toContain(`/commandes/${ORDER_ID}`);
    const meta = mockLogPickupEvent.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === "pickup_attempt_invalid",
    )?.[0] as { metadata: Record<string, unknown> } | undefined;
    expect(meta?.metadata.reason).toBe("order_not_confirmed:pending");
  });

  it("D7 order_already_completed → 409 + completed_at + pas d'email", async () => {
    mockValidatePickup.mockResolvedValue({
      ok: false,
      error: {
        kind: "order_already_completed",
        completed_at: "2026-05-05T14:00:00Z",
        order_id: ORDER_ID,
      },
    });
    const res = await POST(makePost());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; completed_at: string };
    expect(body.error).toBe("pickup_already_completed");
    expect(body.completed_at).toBe("2026-05-05T14:00:00Z");
    expect(mockSendPickupReviewEmail).not.toHaveBeenCalled();
  });

  it("D8 email throw best-effort : la route reste 200 + audit posé", async () => {
    mockValidatePickup.mockResolvedValue({ ok: true, order: sampleValidated });
    mockSendPickupReviewEmail.mockRejectedValue(new Error("Resend down"));
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: typeof sampleValidated };
    expect(body.order.status).toBe("completed");
    // Audit pickup_validated quand même posé
    expect(
      mockLogPickupEvent.mock.calls.filter(
        (c) =>
          (c[0] as { eventType: string }).eventType === "pickup_validated",
      ),
    ).toHaveLength(1);
  });
});

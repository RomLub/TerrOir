// Vitest pour POST /api/webhooks/resend (Audit Email H-3 + M-5, 2026-05-05).
//
// Couverture :
//   - 401 si svix headers manquent
//   - 401 si signature Svix invalide
//   - 200 + deduped si svix-id déjà processé
//   - email.bounced (Permanent) → addSuppression hard_bounce + audit log
//   - email.bounced (Transient) → incrementSoftBounce
//   - email.complained → addSuppression complained + audit log
//   - email.delivered → mergeNotificationMetadata UPDATE delivered_at
//   - email.sent (no-op)
//
// Pattern hoisted env + module-level vi.mock aligné sur
// tests/app/api/stripe/webhook/route.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// --- Hoisted env stubs --------------------------------------------------------
vi.hoisted(() => {
  process.env.RESEND_WEBHOOK_SECRET =
    process.env.RESEND_WEBHOOK_SECRET ??
    `whsec_${Buffer.from("test-secret-bytes-padding-padding").toString("base64")}`;
  // Lib/resend/client.ts throw au module-load si manquant ; le webhook
  // handler ne l'utilise pas mais ses imports transitifs peuvent.
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test";
  process.env.RESEND_FROM_EMAIL =
    process.env.RESEND_FROM_EMAIL ?? "no-reply@example.com";
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "service_role_test";
});

// --- Hoisted mocks ------------------------------------------------------------
const {
  mockCheckOrMarkProcessed,
  mockAddSuppression,
  mockIncrementSoftBounce,
  mockLogPaymentEvent,
  mockCreateAdmin,
} = vi.hoisted(() => ({
  mockCheckOrMarkProcessed: vi.fn(),
  mockAddSuppression: vi.fn(),
  mockIncrementSoftBounce: vi.fn(),
  mockLogPaymentEvent: vi.fn(),
  mockCreateAdmin: vi.fn(),
}));

vi.mock("@/lib/webhook-events/check-or-mark-processed", () => ({
  checkOrMarkProcessed: mockCheckOrMarkProcessed,
}));

vi.mock("@/lib/resend/suppressions", () => ({
  addSuppression: mockAddSuppression,
  incrementSoftBounce: mockIncrementSoftBounce,
}));

vi.mock("@/lib/audit-logs/log-payment-event", () => ({
  logPaymentEvent: mockLogPaymentEvent,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mockCreateAdmin,
}));

import { POST } from "@/app/api/webhooks/resend/route";

// --- Helpers ------------------------------------------------------------------

const RAW_SECRET = process.env.RESEND_WEBHOOK_SECRET!;

function makeSignedHeaders(
  rawBody: string,
  svixId: string,
  ts: number = Math.floor(Date.now() / 1000),
): Headers {
  const stripped = RAW_SECRET.startsWith("whsec_")
    ? RAW_SECRET.slice("whsec_".length)
    : RAW_SECRET;
  const key = Buffer.from(stripped, "base64");
  const signedContent = `${svixId}.${ts}.${rawBody}`;
  const sig = crypto
    .createHmac("sha256", key)
    .update(signedContent, "utf8")
    .digest("base64");
  return new Headers({
    "svix-id": svixId,
    "svix-timestamp": String(ts),
    "svix-signature": `v1,${sig}`,
  });
}

function makeRequest(
  body: object,
  svixId = "msg_test_1",
  signedTs?: number,
  overrideHeaders?: Headers,
): Request {
  const raw = JSON.stringify(body);
  const headers = overrideHeaders ?? makeSignedHeaders(raw, svixId, signedTs);
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers,
    body: raw,
  });
}

function buildMockSupabase() {
  // Builder pour notifications.metadata fetch+merge (mergeNotificationMetadata).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  builder.from = () => builder;
  builder.select = () => builder;
  builder.filter = () => builder;
  builder.limit = () => Promise.resolve({ data: [], error: null });
  builder.update = () => builder;
  builder.eq = () => Promise.resolve({ data: null, error: null });
  return builder;
}

beforeEach(() => {
  mockCheckOrMarkProcessed.mockReset().mockResolvedValue({
    alreadyProcessed: false,
  });
  mockAddSuppression.mockReset().mockResolvedValue(undefined);
  mockIncrementSoftBounce.mockReset().mockResolvedValue(undefined);
  mockLogPaymentEvent.mockReset().mockResolvedValue(undefined);
  mockCreateAdmin.mockReset().mockReturnValue(buildMockSupabase());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// Signature et headers
// =============================================================================

describe("POST /api/webhooks/resend — auth signature", () => {
  it("401 si headers svix manquent", async () => {
    const req = new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"type":"email.delivered"}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockCheckOrMarkProcessed).not.toHaveBeenCalled();
  });

  it("401 si signature Svix invalide", async () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const req = new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: new Headers({
        "svix-id": "msg_invalid",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,bogusbase64ZZZZZZZZZZ==",
      }),
      body,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockCheckOrMarkProcessed).not.toHaveBeenCalled();
    expect(mockAddSuppression).not.toHaveBeenCalled();
  });

  it("401 si timestamp hors tolérance (>5min drift)", async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 600; // -10 min
    const req = makeRequest({ type: "email.delivered" }, "msg_old", oldTs);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Dédup applicative
// =============================================================================

describe("POST /api/webhooks/resend — dédup applicative", () => {
  it("event déjà processé → 200 deduped:true, handlers NON appelés", async () => {
    mockCheckOrMarkProcessed.mockResolvedValue({ alreadyProcessed: true });
    const req = makeRequest({
      type: "email.complained",
      data: { email_id: "em_1", to: ["bad@example.com"] },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true, deduped: true });
    expect(mockAddSuppression).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });

  it("dedupKey namespacé `resend_${svixId}` pour ne pas collisionner avec Stripe", async () => {
    const req = makeRequest(
      { type: "email.delivered", data: { email_id: "em_1" } },
      "msg_xyz",
    );
    await POST(req);
    expect(mockCheckOrMarkProcessed).toHaveBeenCalledWith(
      expect.anything(),
      "resend_msg_xyz",
      "resend_email.delivered",
    );
  });
});

// =============================================================================
// Routing par event type
// =============================================================================

describe("POST /api/webhooks/resend — email.bounced", () => {
  it("bounce.type='Permanent' → addSuppression hard_bounce + audit log email_hard_bounce_suppressed", async () => {
    const req = makeRequest({
      type: "email.bounced",
      data: {
        email_id: "em_perm",
        to: ["bounced@example.com"],
        bounce: { type: "Permanent", subType: "Suppressed" },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockAddSuppression).toHaveBeenCalledWith(
      "bounced@example.com",
      "hard_bounce",
      "em_perm",
    );
    expect(mockIncrementSoftBounce).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).toHaveBeenCalledWith({
      eventType: "email_hard_bounce_suppressed",
      metadata: expect.objectContaining({
        email: "bounced@example.com",
        source_resend_id: "em_perm",
        bounce_type: "Permanent",
        bounce_subtype: "Suppressed",
      }),
    });
  });

  it("bounce.type='Transient' → incrementSoftBounce, pas d'audit log immédiat", async () => {
    const req = makeRequest({
      type: "email.bounced",
      data: {
        email_id: "em_soft",
        to: ["soft@example.com"],
        bounce: { type: "Transient" },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockIncrementSoftBounce).toHaveBeenCalledWith(
      "soft@example.com",
      "em_soft",
    );
    expect(mockAddSuppression).not.toHaveBeenCalled();
    // Audit log seulement quand le seuil est franchi côté incrementSoftBounce —
    // pas posé ici (responsabilité côté helper si on l'ajoute V1.x).
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });

  it("bounce.type='Undetermined' → traité comme hard (safety net)", async () => {
    const req = makeRequest({
      type: "email.bounced",
      data: {
        email_id: "em_undef",
        to: ["undef@example.com"],
        bounce: { type: "Undetermined" },
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockAddSuppression).toHaveBeenCalledWith(
      "undef@example.com",
      "hard_bounce",
      "em_undef",
    );
  });
});

describe("POST /api/webhooks/resend — email.complained", () => {
  it("addSuppression complained + audit log email_complaint_received (légal CASL)", async () => {
    const req = makeRequest({
      type: "email.complained",
      data: {
        email_id: "em_spam",
        to: ["complainer@example.com"],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockAddSuppression).toHaveBeenCalledWith(
      "complainer@example.com",
      "complained",
      "em_spam",
    );
    expect(mockLogPaymentEvent).toHaveBeenCalledWith({
      eventType: "email_complaint_received",
      metadata: expect.objectContaining({
        email: "complainer@example.com",
        source_resend_id: "em_spam",
      }),
    });
  });
});

describe("POST /api/webhooks/resend — email.delivered", () => {
  it("UPDATE notifications.metadata via mergeNotificationMetadata (no-op si row absente)", async () => {
    const req = makeRequest({
      type: "email.delivered",
      data: {
        email_id: "em_delivered",
        to: ["ok@example.com"],
        created_at: "2026-05-05T10:00:00.000Z",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Les helpers de suppression ne sont pas appelés sur delivered
    expect(mockAddSuppression).not.toHaveBeenCalled();
    expect(mockIncrementSoftBounce).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/resend — events no-op", () => {
  it("email.sent → 200 sans effet de bord", async () => {
    const req = makeRequest({
      type: "email.sent",
      data: { email_id: "em_sent", to: ["someone@example.com"] },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockAddSuppression).not.toHaveBeenCalled();
    expect(mockIncrementSoftBounce).not.toHaveBeenCalled();
    expect(mockLogPaymentEvent).not.toHaveBeenCalled();
  });

  it("event_type inconnu → 200 + log info, no-op", async () => {
    const req = makeRequest({
      type: "email.future_unknown_event",
      data: { email_id: "em_unknown" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockAddSuppression).not.toHaveBeenCalled();
  });
});

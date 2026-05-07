// Tests vitest pour POST /api/contact (page P0 légales 2026-05-06).
//
// Stratégie : mock de resend.emails.send + createSupabaseAdminClient +
// rate-limit. La route ne délègue pas à un helper métier dédié donc les
// tests couvrent directement validation Zod, honeypot, rate-limit, envoi
// Resend et insert audit_logs.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test";
  process.env.RESEND_FROM_EMAIL =
    process.env.RESEND_FROM_EMAIL ?? "no-reply@terroir-local.fr";
});

const {
  mockResendSend,
  mockConsumeRateLimit,
  mockGetContactFormRateLimit,
  mockClientHolder,
  capturedInserts,
} = vi.hoisted(() => ({
  mockResendSend: vi.fn(),
  mockConsumeRateLimit: vi.fn(),
  mockGetContactFormRateLimit: vi.fn(),
  mockClientHolder: { current: null as SupabaseClient | null },
  capturedInserts: [] as Array<{ table: string; row: unknown }>,
}));

vi.mock("@/lib/resend/client", () => ({
  resend: { emails: { send: mockResendSend } },
  resendFromEmail: "no-reply@terroir-local.fr",
}));
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mockConsumeRateLimit,
  getContactFormRateLimit: mockGetContactFormRateLimit,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockClientHolder.current!,
}));

import { POST } from "@/app/api/contact/route";

function buildMockClient(): SupabaseClient {
  return {
    from: (table: string) => ({
      insert: (row: unknown) => {
        capturedInserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  } as unknown as SupabaseClient;
}

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.42",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  sujet: "question",
  nom: "Camille Martin",
  email: "Camille.Martin@example.com",
  telephone: "0612345678",
  message: "Bonjour, je voudrais en savoir plus sur vos produits.",
  consent: true,
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockResendSend.mockReset();
  mockConsumeRateLimit.mockReset();
  mockGetContactFormRateLimit.mockReset();
  capturedInserts.length = 0;
  mockClientHolder.current = buildMockClient();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  // Default : rate-limit OK + Resend OK.
  mockGetContactFormRateLimit.mockReturnValue(null);
  mockConsumeRateLimit.mockResolvedValue({
    success: true,
    limit: 3,
    remaining: 2,
    reset: 0,
  });
  mockResendSend.mockResolvedValue({
    data: { id: "resend-123" },
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/contact — happy path", () => {
  it("payload valide → 200 ok:true + email envoyé via Resend", async () => {
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockResendSend.mock.calls[0][0];
    expect(sendArgs.from).toBe("no-reply@terroir-local.fr");
    expect(sendArgs.to).toBe("contact@terroir-local.fr");
    // Email visiteur en Reply-To pour permettre clic "Répondre" → visiteur.
    expect(sendArgs.replyTo).toBe("camille.martin@example.com");
    expect(typeof sendArgs.subject).toBe("string");
    expect(sendArgs.subject).toContain("Camille Martin");
    expect(typeof sendArgs.html).toBe("string");
    expect(sendArgs.html.length).toBeGreaterThan(0);
  });

  it("audit_logs INSERT inséré avec event_type=contact_form_submitted", async () => {
    await POST(buildRequest(VALID_BODY));
    const auditInsert = capturedInserts.find((i) => i.table === "audit_logs");
    expect(auditInsert).toBeTruthy();
    const row = auditInsert!.row as {
      event_type: string;
      ip_address: string | null;
      metadata: Record<string, unknown>;
    };
    expect(row.event_type).toBe("contact_form_submitted");
    // sec-P2-2 (T9 2026-05-07) : IP masquée /24 + email masqué + nom retiré
    // (déviation doctrine T-200 r1 corrigée).
    expect(row.ip_address).toBe("203.0.113.0");
    expect(row.metadata.sujet).toBe("question");
    expect(row.metadata.email_masked).toBe("ca***@example.com");
    expect(row.metadata.has_nom).toBe(true);
    expect(row.metadata.email).toBeUndefined();
    expect(row.metadata.nom).toBeUndefined();
    expect(row.metadata.has_telephone).toBe(true);
  });
});

describe("POST /api/contact — validation Zod", () => {
  it("body non JSON → 400", async () => {
    const req = buildRequest("not-json");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("sujet inconnu → 400", async () => {
    const res = await POST(
      buildRequest({ ...VALID_BODY, sujet: "spam-promo" }),
    );
    expect(res.status).toBe(400);
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("email invalide → 400", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, email: "not-email" }));
    expect(res.status).toBe(400);
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("nom vide → 400", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, nom: "  " }));
    expect(res.status).toBe(400);
  });

  it("message < 20 caractères → 400", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, message: "trop court" }));
    expect(res.status).toBe(400);
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("consent absent → 400 (consentement RGPD obligatoire)", async () => {
    const { consent: _omit, ...partial } = VALID_BODY;
    void _omit;
    const res = await POST(buildRequest(partial));
    expect(res.status).toBe(400);
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("consent=false → 400", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, consent: false }));
    expect(res.status).toBe(400);
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("téléphone vide string → accepté (transform → undefined)", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, telephone: "" }));
    expect(res.status).toBe(200);
    const sendArgs = mockResendSend.mock.calls[0][0];
    // Le template ne doit pas afficher la ligne téléphone — vérification
    // indirecte : html ne contient pas le mot "Téléphone" dans le bloc tableau.
    // Sécurité : juste s'assurer que le 200 est passé sans throw.
    expect(typeof sendArgs.html).toBe("string");
  });
});

describe("POST /api/contact — rate-limit", () => {
  it("rate-limit dépassé → 429 + pas d'envoi", async () => {
    mockConsumeRateLimit.mockResolvedValueOnce({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 3600_000,
    });
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/heure|messages/i);
    expect(mockResendSend).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it("rate-limit consume utilise IP extraite du header x-forwarded-for", async () => {
    await POST(buildRequest(VALID_BODY));
    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
    const [, identifier] = mockConsumeRateLimit.mock.calls[0];
    expect(identifier).toBe("203.0.113.42");
  });
});

describe("POST /api/contact — honeypot", () => {
  it("champ website rempli → 200 silencieux + pas d'envoi + pas d'audit", async () => {
    const res = await POST(
      buildRequest({ ...VALID_BODY, website: "http://spambot.example" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(mockResendSend).not.toHaveBeenCalled();
    // Pas d'INSERT audit_logs sur honeypot hit (bruit pollutif).
    const auditInsert = capturedInserts.find((i) => i.table === "audit_logs");
    expect(auditInsert).toBeUndefined();
    // Mais on warn pour suivi observability.
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it("website='' (vide) → flow normal, envoi OK", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, website: "" }));
    expect(res.status).toBe(200);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/contact — erreurs Resend", () => {
  it("Resend retourne error → 502", async () => {
    mockResendSend.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limit Resend" },
    });
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(502);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("Resend throw → 502", async () => {
    mockResendSend.mockRejectedValueOnce(new Error("network down"));
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(502);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

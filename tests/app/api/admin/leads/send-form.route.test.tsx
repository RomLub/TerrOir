import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/env/urls", () => ({ NEXT_PUBLIC_APP_URL: "https://www.test.fr" }));

const { mockGet, mockPersist, mockFollowup, mockLog, mockSend, mockGenPrefill, mockGenOptOut } =
  vi.hoisted(() => ({
    mockGet: vi.fn(),
    mockPersist: vi.fn(),
    mockFollowup: vi.fn(),
    mockLog: vi.fn(),
    mockSend: vi.fn(),
    mockGenPrefill: vi.fn(),
    mockGenOptOut: vi.fn(),
  }));
vi.mock("@/lib/admin/producer-interests/fetch", () => ({ getProducerInterest: mockGet }));
vi.mock("@/lib/admin/producer-interests/mutations", () => ({
  setLeadPrefillTokenAndAdvance: mockPersist,
  logLeadFollowup: mockFollowup,
}));
vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));
vi.mock("@/lib/resend/send", () => ({ sendTemplate: mockSend }));
vi.mock("@/lib/leads/prefill-token", () => ({ generatePrefillToken: mockGenPrefill }));
vi.mock("@/lib/rgpd/opt-out-token", () => ({ generateOptOutToken: mockGenOptOut }));

import { POST } from "@/app/api/admin/leads/[id]/send-form/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  sessionUser = { id: "admin-1", email: "a@x.fr", isAdmin: true };
  mockGet.mockReset().mockResolvedValue({ id: "l1", email: "lead@y.fr", prenom: "Jean" });
  mockGenPrefill.mockReset().mockReturnValue({
    token: "tok-123",
    expiresAt: new Date("2026-06-21T00:00:00Z"),
  });
  mockGenOptOut.mockReset().mockReturnValue({ token: "opt-123", expiresAt: new Date() });
  mockSend.mockReset().mockResolvedValue({ ok: true, id: "email-1" });
  mockPersist.mockReset().mockResolvedValue({ ok: true, data: null });
  mockFollowup.mockReset().mockResolvedValue({ ok: true, data: { id: "fu1" } });
  mockLog.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/admin/leads/[id]/send-form", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await POST({} as Request, ctx("l1"));
    expect(res.status).toBe(403);
  });

  it("lead introuvable → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await POST({} as Request, ctx("nope"));
    expect(res.status).toBe(404);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("succès → email envoyé avec lien prefill, persist step3, followup, audit", async () => {
    const res = await POST({} as Request, ctx("l1"));
    expect(res.status).toBe(200);
    // CTA contient le token prefill
    const sendArg = mockSend.mock.calls[0][0];
    expect(sendArg.template).toBe("lead_form_invitation");
    expect(sendArg.to).toBe("lead@y.fr");
    // persistance token + avance étape 3
    expect(mockPersist).toHaveBeenCalledWith({}, "l1", "tok-123", "2026-06-21T00:00:00.000Z");
    expect(mockFollowup).toHaveBeenCalledOnce();
    expect(mockLog.mock.calls[0][0].eventType).toBe("producer_interest_form_sent");
  });

  it("email supprimé (opt-out) → 409, pas de persist", async () => {
    mockSend.mockResolvedValue({ ok: false, skipped: true, error: "suppressed" });
    const res = await POST({} as Request, ctx("l1"));
    expect(res.status).toBe(409);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("échec envoi → 502, pas de persist ni audit", async () => {
    mockSend.mockResolvedValue({ ok: false, error: "5xx" });
    const res = await POST({} as Request, ctx("l1"));
    expect(res.status).toBe(502);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });
});

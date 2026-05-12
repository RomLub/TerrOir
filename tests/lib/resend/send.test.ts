// Vitest pour lib/resend/send.ts — couverture pre-send check canSendTo
// (Audit Email H-3 + M-5, 2026-05-05).
//
// Focus : le nouveau guard de suppression (Lot 4 du fix). Les paths nominal
// /failed étaient implicitement couverts par les tests de templates et les
// e2e — pas réécrits ici (scope minimal sur le diff).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted env stubs : lib/resend/client.ts throw au module-load si manquants
vi.hoisted(() => {
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? "re_test";
  process.env.RESEND_FROM_EMAIL =
    process.env.RESEND_FROM_EMAIL ?? "no-reply@example.com";
});

// --- Mocks --------------------------------------------------------------------

const { mockCanSendTo, mockResendSend, mockNotificationsInsert } = vi.hoisted(
  () => ({
    mockCanSendTo: vi.fn(),
    mockResendSend: vi.fn(),
    mockNotificationsInsert: vi.fn(),
  }),
);

vi.mock("@/lib/resend/suppressions", () => ({
  canSendTo: mockCanSendTo,
}));

vi.mock("@/lib/resend/client", () => ({
  resend: { emails: { send: mockResendSend } },
  resendFromEmail: "no-reply@example.com",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      insert: (payload: unknown) => mockNotificationsInsert(payload),
    }),
  }),
}));

vi.mock("@react-email/render", () => ({
  render: () => Promise.resolve("<p>html</p>"),
}));

import { sendTemplate } from "@/lib/resend/send";

beforeEach(() => {
  mockCanSendTo.mockReset();
  mockResendSend.mockReset();
  mockNotificationsInsert.mockReset().mockResolvedValue({ error: null });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseArgs = {
  to: "user@example.com",
  userId: "user-1",
  template: "test_template",
  subject: "Subject",
  element: null as any,
  metadata: { context: "test" },
};

describe("sendTemplate — canSendTo guard (H-3 + M-5)", () => {
  it("court-circuite resend.emails.send si canSendTo retourne false", async () => {
    mockCanSendTo.mockResolvedValue(false);

    const result = await sendTemplate(baseArgs);

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: "suppressed",
    });
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("INSERT notifications statut='skipped' avec metadata.skip_reason='suppressed' + email", async () => {
    mockCanSendTo.mockResolvedValue(false);

    await sendTemplate(baseArgs);

    expect(mockNotificationsInsert).toHaveBeenCalledTimes(1);
    expect(mockNotificationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        type: "email",
        template: "test_template",
        statut: "skipped",
        metadata: expect.objectContaining({
          skip_reason: "suppressed",
          email: "user@example.com",
          context: "test",
        }),
      }),
    );
  });

  it("flow nominal si canSendTo retourne true → resend.emails.send appelé", async () => {
    mockCanSendTo.mockResolvedValue(true);
    mockResendSend.mockResolvedValue({
      data: { id: "resend_id_1" },
      error: null,
    });

    const result = await sendTemplate(baseArgs);

    expect(result).toEqual({ ok: true, id: "resend_id_1" });
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(mockNotificationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ statut: "sent" }),
    );
  });
});

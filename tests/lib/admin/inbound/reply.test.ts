import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tests sendInboundReply (chantier 9) : validation, envoi Resend depuis
// contact@ avec threading, replied_at + audit.

const { sendMock, auditMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  auditMock: vi.fn(async () => undefined),
}));
vi.mock("@/lib/resend/client", () => ({ resend: { emails: { send: sendMock } } }));
vi.mock("@/lib/audit-logs/log-inbound-email-event", () => ({
  logInboundEmailEvent: auditMock,
}));

import { sendInboundReply } from "@/lib/admin/inbound/reply";

function makeAdmin(inbound: unknown, account: unknown) {
  const updates: unknown[] = [];
  const admin = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () =>
        Promise.resolve({
          data: table === "inbound_emails" ? inbound : account,
          error: null,
        });
      b.update = (vals: unknown) => {
        updates.push(vals);
        return { eq: () => Promise.resolve({ error: null }) };
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { admin, updates };
}

const INBOUND = {
  id: "m1",
  from_email: "client@x.fr",
  message_id: "<abc@mail>",
  account_id: "acc1",
};

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: "re_1" }, error: null });
  auditMock.mockClear();
});

describe("sendInboundReply", () => {
  it("sujet ou corps vide → erreur, pas d'envoi", async () => {
    const { admin } = makeAdmin(INBOUND, { address: "contact@terroir-local.fr" });
    const res = await sendInboundReply(admin, "a1", "m1", "  ", "  ");
    expect(res.ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("email introuvable → erreur", async () => {
    const { admin } = makeAdmin(null, null);
    const res = await sendInboundReply(admin, "a1", "m1", "Re: x", "Bonjour");
    expect(res.ok).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("succès → envoi depuis l'adresse du compte + threading + replied_at + audit", async () => {
    const { admin, updates } = makeAdmin(INBOUND, { address: "contact@terroir-local.fr" });
    const res = await sendInboundReply(admin, "a1", "m1", "Re: question", "Bonjour, voici la réponse.");
    expect(res).toEqual({ ok: true });
    const call = sendMock.mock.calls[0][0];
    expect(call.from).toBe("contact@terroir-local.fr");
    expect(call.to).toBe("client@x.fr");
    expect(call.headers["In-Reply-To"]).toBe("<abc@mail>");
    expect(call.headers.References).toBe("<abc@mail>");
    expect(updates).toEqual([expect.objectContaining({ replied_at: expect.any(String) })]);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "inbound_email_replied", userId: "a1" }),
    );
  });

  it("échec Resend → erreur, pas d'audit", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "Resend down" } });
    const { admin } = makeAdmin(INBOUND, { address: "contact@terroir-local.fr" });
    const res = await sendInboundReply(admin, "a1", "m1", "Re: x", "Bonjour");
    expect(res.ok).toBe(false);
    expect(auditMock).not.toHaveBeenCalled();
  });
});

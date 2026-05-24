import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests routes chantier 9 : cron fetch-inbound (gate désactivé + auth) +
// reply (gate admin). Logique métier mockée.

const { sessionMock, pollMock, replyMock } = vi.hoisted(() => {
  process.env.CRON_SECRET = "test_cron_secret";
  return { sessionMock: vi.fn(), pollMock: vi.fn(), replyMock: vi.fn() };
});

vi.mock("@/lib/auth/session", () => ({ getSessionUser: sessionMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/admin/inbound/imap-fetch", () => ({ pollInbound: pollMock }));
vi.mock("@/lib/admin/inbound/reply", () => ({ sendInboundReply: replyMock }));

import { POST as cronPOST } from "@/app/api/cron/fetch-inbound/route";
import { POST as replyPOST } from "@/app/api/admin/mails/[id]/reply/route";

function cronReq(secret: string): Request {
  return new Request("http://x/api/cron/fetch-inbound", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  sessionMock.mockReset();
  pollMock.mockReset();
  replyMock.mockReset();
  delete process.env.INBOUND_EMAIL_CRON_ENABLED;
});

describe("POST /api/cron/fetch-inbound", () => {
  it("mauvais secret → 401", async () => {
    const res = await cronPOST(cronReq("wrong"));
    expect(res.status).toBe(401);
    expect(pollMock).not.toHaveBeenCalled();
  });

  it("cron désactivé (flag absent) → skipped, poll NON appelé", async () => {
    const res = await cronPOST(cronReq("test_cron_secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe("cron_disabled");
    expect(pollMock).not.toHaveBeenCalled();
  });

  it("cron activé + auth ok → poll appelé", async () => {
    process.env.INBOUND_EMAIL_CRON_ENABLED = "true";
    pollMock.mockResolvedValue([{ account: "contact@x.fr", fetched: 0, inserted: 0, reset: true, error: null }]);
    const res = await cronPOST(cronReq("test_cron_secret"));
    expect(res.status).toBe(200);
    expect(pollMock).toHaveBeenCalledOnce();
  });
});

describe("POST /api/admin/mails/[id]/reply", () => {
  const params = { params: Promise.resolve({ id: "m1" }) };
  function req(body: unknown): Request {
    return new Request("http://x/api/admin/mails/m1/reply", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  it("non-admin → 403", async () => {
    sessionMock.mockResolvedValue(null);
    const res = await replyPOST(req({ subject: "Re", body: "x" }), params);
    expect(res.status).toBe(403);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("admin → appelle sendInboundReply + 200", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true });
    replyMock.mockResolvedValue({ ok: true });
    const res = await replyPOST(req({ subject: "Re: x", body: "Bonjour" }), params);
    expect(res.status).toBe(200);
    expect(replyMock).toHaveBeenCalledWith({}, "a1", "m1", "Re: x", "Bonjour");
  });

  it("op refuse → 400 + message", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true });
    replyMock.mockResolvedValue({ ok: false, error: "Échec d'envoi." });
    const res = await replyPOST(req({ subject: "Re", body: "x" }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Échec d'envoi.");
  });
});

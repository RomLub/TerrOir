import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

const { mockGet, mockLogFollowup, mockLog } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockLogFollowup: vi.fn(),
  mockLog: vi.fn(),
}));
vi.mock("@/lib/admin/producer-interests/fetch", () => ({ getProducerInterest: mockGet }));
vi.mock("@/lib/admin/producer-interests/mutations", () => ({ logLeadFollowup: mockLogFollowup }));
vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));

import { POST } from "@/app/api/admin/leads/[id]/followup/route";

const req = (body: unknown): Request =>
  ({ json: async () => body }) as unknown as Request;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  sessionUser = { id: "admin-1", email: "a@x.fr", isAdmin: true };
  mockGet.mockReset().mockResolvedValue({ id: "l1", email: "lead@y.fr" });
  mockLogFollowup.mockReset().mockResolvedValue({ ok: true, data: { id: "fu1" } });
  mockLog.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/admin/leads/[id]/followup", () => {
  it("non admin → 403", async () => {
    sessionUser = { id: "u", email: null, isAdmin: false };
    const res = await POST(req({ channel: "email", direction: "outbound" }), ctx("l1"));
    expect(res.status).toBe(403);
  });

  it("channel invalide → 400", async () => {
    const res = await POST(req({ channel: "telepathy", direction: "outbound" }), ctx("l1"));
    expect(res.status).toBe(400);
    expect(mockLogFollowup).not.toHaveBeenCalled();
  });

  it("direction invalide → 400", async () => {
    const res = await POST(req({ channel: "phone", direction: "sideways" }), ctx("l1"));
    expect(res.status).toBe(400);
  });

  it("lead introuvable → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await POST(req({ channel: "phone", direction: "inbound" }), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("succès → 201 + audit followup_logged", async () => {
    const res = await POST(
      req({ channel: "rdv", direction: "outbound", note: "RDV ferme" }),
      ctx("l1"),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "fu1" });
    expect(mockLogFollowup.mock.calls[0][1]).toMatchObject({
      leadId: "l1",
      channel: "rdv",
      direction: "outbound",
      note: "RDV ferme",
      isAutomatic: false,
    });
    expect(mockLog.mock.calls[0][0].eventType).toBe("producer_interest_followup_logged");
  });
});

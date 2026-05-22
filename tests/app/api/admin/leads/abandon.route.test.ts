import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

const { mockGet, mockAbandon, mockLog } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAbandon: vi.fn(),
  mockLog: vi.fn(),
}));
vi.mock("@/lib/admin/producer-interests/fetch", () => ({ getProducerInterest: mockGet }));
vi.mock("@/lib/admin/producer-interests/mutations", () => ({ abandonLead: mockAbandon }));
vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));

import { POST } from "@/app/api/admin/leads/[id]/abandon/route";

const req = (body: unknown): Request =>
  ({ json: async () => body }) as unknown as Request;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  sessionUser = { id: "admin-1", email: "a@x.fr", isAdmin: true };
  mockGet.mockReset().mockResolvedValue({ id: "l1", email: "lead@y.fr" });
  mockAbandon.mockReset().mockResolvedValue({ ok: true, data: null });
  mockLog.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/admin/leads/[id]/abandon", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await POST(req({ reason: "x" }), ctx("l1"));
    expect(res.status).toBe(403);
  });

  it("raison vide → 400", async () => {
    const res = await POST(req({ reason: "" }), ctx("l1"));
    expect(res.status).toBe(400);
    expect(mockAbandon).not.toHaveBeenCalled();
  });

  it("lead introuvable → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await POST(req({ reason: "pas intéressé" }), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("succès → 200 + audit abandoned_manual avec raison", async () => {
    const res = await POST(req({ reason: "ne répond plus" }), ctx("l1"));
    expect(res.status).toBe(200);
    expect(mockAbandon).toHaveBeenCalledWith({}, "l1", "ne répond plus");
    const audit = mockLog.mock.calls[0][0];
    expect(audit.eventType).toBe("producer_interest_abandoned_manual");
    expect(audit.metadata).toMatchObject({ reason: "ne répond plus" });
  });
});

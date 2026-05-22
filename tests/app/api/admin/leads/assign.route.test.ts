import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

const { mockGet, mockAssign, mockLog } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAssign: vi.fn(),
  mockLog: vi.fn(),
}));
vi.mock("@/lib/admin/producer-interests/fetch", () => ({ getProducerInterest: mockGet }));
vi.mock("@/lib/admin/producer-interests/mutations", () => ({ assignLead: mockAssign }));
vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));

import { PATCH } from "@/app/api/admin/leads/[id]/assign/route";

const req = (body: unknown): Request =>
  ({ json: async () => body }) as unknown as Request;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const REF = "11111111-2222-4333-8444-555555555555";
const LEAD = { id: "l1", email: "lead@y.fr", assigned_to: null };

beforeEach(() => {
  sessionUser = { id: "admin-1", email: "a@x.fr", isAdmin: true };
  mockGet.mockReset().mockResolvedValue(LEAD);
  mockAssign.mockReset().mockResolvedValue({ ok: true, data: null });
  mockLog.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("PATCH /api/admin/leads/[id]/assign", () => {
  it("non admin → 403", async () => {
    sessionUser = { id: "u", email: null, isAdmin: false };
    const res = await PATCH(req({ assigned_to: REF }), ctx("l1"));
    expect(res.status).toBe(403);
  });

  it("assigned_to non-uuid → 400", async () => {
    const res = await PATCH(req({ assigned_to: "abc" }), ctx("l1"));
    expect(res.status).toBe(400);
  });

  it("désassignation (null) acceptée → 200", async () => {
    const res = await PATCH(req({ assigned_to: null }), ctx("l1"));
    expect(res.status).toBe(200);
    expect(mockAssign).toHaveBeenCalledWith({}, "l1", null);
    expect(mockLog.mock.calls[0][0].eventType).toBe("producer_interest_assigned");
  });

  it("référent invalide (FK) → 400", async () => {
    mockAssign.mockResolvedValue({ ok: false, error: "fk" });
    const res = await PATCH(req({ assigned_to: REF }), ctx("l1"));
    expect(res.status).toBe(400);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("lead introuvable → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await PATCH(req({ assigned_to: REF }), ctx("nope"));
    expect(res.status).toBe(404);
  });
});

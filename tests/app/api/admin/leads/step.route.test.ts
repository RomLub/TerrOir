import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

const { mockGet, mockSetStep, mockLog } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSetStep: vi.fn(),
  mockLog: vi.fn(),
}));
vi.mock("@/lib/admin/producer-interests/fetch", () => ({ getProducerInterest: mockGet }));
vi.mock("@/lib/admin/producer-interests/mutations", () => ({ setLeadStep: mockSetStep }));
vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));

import { PATCH } from "@/app/api/admin/leads/[id]/step/route";

const req = (body: unknown): Request =>
  ({ json: async () => body }) as unknown as Request;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const LEAD = { id: "l1", email: "lead@y.fr", current_step: 1 };

beforeEach(() => {
  sessionUser = { id: "admin-1", email: "a@x.fr", isAdmin: true };
  mockGet.mockReset().mockResolvedValue(LEAD);
  mockSetStep.mockReset().mockResolvedValue({ ok: true, data: null });
  mockLog.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("PATCH /api/admin/leads/[id]/step", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await PATCH(req({ step: 2 }), ctx("l1"));
    expect(res.status).toBe(403);
  });

  it("step hors [1..6] → 400", async () => {
    const res = await PATCH(req({ step: 9 }), ctx("l1"));
    expect(res.status).toBe(400);
    expect(mockSetStep).not.toHaveBeenCalled();
  });

  it("lead introuvable → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await PATCH(req({ step: 2 }), ctx("nope"));
    expect(res.status).toBe(404);
    expect(mockSetStep).not.toHaveBeenCalled();
  });

  it("succès → 200 + audit step_advanced (previous/new)", async () => {
    const res = await PATCH(req({ step: 4 }), ctx("l1"));
    expect(res.status).toBe(200);
    expect(mockSetStep).toHaveBeenCalledWith({}, "l1", 4);
    const audit = mockLog.mock.calls[0][0];
    expect(audit.eventType).toBe("producer_interest_step_advanced");
    expect(audit.metadata).toMatchObject({ previous_step: 1, new_step: 4 });
  });

  it("helper ok:false → 500 sans audit", async () => {
    mockSetStep.mockResolvedValue({ ok: false, error: "db" });
    const res = await PATCH(req({ step: 3 }), ctx("l1"));
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
  });
});

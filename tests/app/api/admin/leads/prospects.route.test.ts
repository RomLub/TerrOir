import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

const { mockCreate, mockLog } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockLog: vi.fn(),
}));
vi.mock("@/lib/admin/producer-interests/mutations", () => ({
  createProspectLead: mockCreate,
}));
vi.mock("@/lib/audit-logs/log-producer-interests-event", () => ({
  logProducerInterestsEvent: mockLog,
}));

import { POST } from "@/app/api/admin/leads/prospects/route";

const req = (body: unknown): Request =>
  ({ json: async () => body }) as unknown as Request;

beforeEach(() => {
  sessionUser = { id: "admin-1", email: "a@x.fr", isAdmin: true };
  mockCreate.mockReset().mockResolvedValue({ ok: true, data: { id: "lead-9" } });
  mockLog.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/admin/leads/prospects", () => {
  it("non admin → 403", async () => {
    sessionUser = { id: "u", email: null, isAdmin: false };
    const res = await POST(req({ nom: "X", email: "x@y.fr" }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("body invalide (email manquant) → 400", async () => {
    const res = await POST(req({ nom: "X" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("succès → 201 + audit producer_interest_prospect_created", async () => {
    const res = await POST(req({ nom: "Dupont", email: "Lead@Y.FR", telephone: "" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "lead-9" });
    expect(mockCreate).toHaveBeenCalledOnce();
    // email normalisé lowercase, champs vides → null
    expect(mockCreate.mock.calls[0][1]).toMatchObject({
      nom: "Dupont",
      email: "lead@y.fr",
      telephone: null,
    });
    expect(mockLog.mock.calls[0][0].eventType).toBe(
      "producer_interest_prospect_created",
    );
  });

  it("helper ok:false → 500 sans audit", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "db" });
    const res = await POST(req({ nom: "X", email: "x@y.fr" }));
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
  });
});

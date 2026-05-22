import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));
vi.mock("@/lib/admin/producer-interests/fetch", () => ({ fetchAdminLeadsList: mockList }));

import { GET } from "@/app/api/admin/leads/route";

const req = (url: string): Request =>
  ({ url: `http://localhost${url}` }) as unknown as Request;

beforeEach(() => {
  sessionUser = { id: "admin-1", email: "a@x.fr", isAdmin: true };
  mockList.mockReset().mockResolvedValue([{ id: "l1" }, { id: "l2" }]);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/admin/leads", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await GET(req("/api/admin/leads"));
    expect(res.status).toBe(403);
  });

  it("succès → count + leads", async () => {
    const res = await GET(req("/api/admin/leads"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2, leads: [{ id: "l1" }, { id: "l2" }] });
  });

  it("filtres source/step/referent parsés et transmis", async () => {
    const ref = "11111111-2222-4333-8444-555555555555";
    await GET(req(`/api/admin/leads?source=invitation_directe&step=3&referent=${ref}`));
    expect(mockList.mock.calls[0][1]).toEqual({
      source: "invitation_directe",
      step: 3,
      assignedTo: ref,
    });
  });

  it("filtres invalides ignorés (source/step hors bornes)", async () => {
    await GET(req("/api/admin/leads?source=garbage&step=99&referent=notuuid"));
    expect(mockList.mock.calls[0][1]).toEqual({
      source: undefined,
      step: undefined,
      assignedTo: undefined,
    });
  });

  it("throw fetch → 500", async () => {
    mockList.mockRejectedValue(new Error("db"));
    const res = await GET(req("/api/admin/leads"));
    expect(res.status).toBe(500);
  });
});

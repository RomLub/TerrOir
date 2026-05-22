import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));

const { mockRpc, mockLog } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockLog: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mockRpc }),
}));
vi.mock("@/lib/audit-logs/log-producers-admin-event", () => ({
  logProducersAdminEvent: mockLog,
}));

import { POST } from "@/app/api/producer/request-publication/route";

beforeEach(() => {
  sessionUser = { id: "prod-user-1", email: "p@x.fr", isAdmin: false };
  mockRpc.mockReset();
  mockLog.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/producer/request-publication", () => {
  it("non connecté → 401", async () => {
    sessionUser = null;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("critères OK → 200 + audit producer_publication_requested", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, publication_requested_at: "2026-05-22T10:00:00Z" },
      error: null,
    });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("request_publication", {
      p_user_id: "prod-user-1",
    });
    expect(mockLog.mock.calls[0][0].eventType).toBe("producer_publication_requested");
  });

  it("déjà public → 200 sans nouvel audit", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, already_public: true }, error: null });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("critères manquants → 422 avec la liste", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, missing: ["description", "stripe"] },
      error: null,
    });
    const res = await POST();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, missing: ["description", "stripe"] });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("statut bloqué → 422 blocked", async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, blocked: "suspended" }, error: null });
    const res = await POST();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, blocked: "suspended" });
  });

  it("erreur RPC → 500", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST();
    expect(res.status).toBe(500);
  });
});

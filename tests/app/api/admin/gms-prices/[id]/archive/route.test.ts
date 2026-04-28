// Tests vitest pour POST /api/admin/gms-prices/[id]/archive (soft delete bidirectionnel).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
} | null;

let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

let preCheckResp: { data: unknown; error: unknown } = {
  data: { id: "ref-1" },
  error: null,
};
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = () => Promise.resolve(preCheckResp);
      return builder;
    },
  }),
}));

const { mockArchive } = vi.hoisted(() => ({ mockArchive: vi.fn() }));

vi.mock("@/lib/gms-prices/admin-write", () => ({
  archiveGmsPrice: mockArchive,
}));

import { POST } from "@/app/api/admin/gms-prices/[id]/archive/route";

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

const CTX = { params: { id: "ref-1" } };

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  preCheckResp = { data: { id: "ref-1" }, error: null };
  mockArchive.mockReset().mockResolvedValue({ ok: true, data: null });
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/gms-prices/[id]/archive", () => {
  it("non-admin → 403", async () => {
    sessionUser = null;
    const res = await POST(makeRequest({ action: "archive" }), CTX);
    expect(res.status).toBe(403);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it("body action absent → 400", async () => {
    const res = await POST(makeRequest({}), CTX);
    expect(res.status).toBe(400);
  });

  it("body action hors enum → 400", async () => {
    const res = await POST(makeRequest({ action: "delete" }), CTX);
    expect(res.status).toBe(400);
  });

  it("ID inexistant → 404", async () => {
    preCheckResp = { data: null, error: null };
    const res = await POST(makeRequest({ action: "archive" }), CTX);
    expect(res.status).toBe(404);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it("action='archive' → helper appelé avec active=false", async () => {
    const res = await POST(makeRequest({ action: "archive" }), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "ref-1", active: false });
    expect(mockArchive).toHaveBeenCalledOnce();
    const [, id, active, adminId] = mockArchive.mock.calls[0];
    expect(id).toBe("ref-1");
    expect(active).toBe(false);
    expect(adminId).toBe("admin-1");
  });

  it("action='restore' → helper appelé avec active=true", async () => {
    const res = await POST(makeRequest({ action: "restore" }), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "ref-1", active: true });
    const [, , active] = mockArchive.mock.calls[0];
    expect(active).toBe(true);
  });

  it("helper fail → 500", async () => {
    mockArchive.mockResolvedValue({ ok: false, error: "db error" });
    const res = await POST(makeRequest({ action: "archive" }), CTX);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db error" });
  });
});

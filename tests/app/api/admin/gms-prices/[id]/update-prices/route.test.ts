// Tests vitest pour POST /api/admin/gms-prices/[id]/update-prices (workflow mensuel).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const { mockMonthly } = vi.hoisted(() => ({ mockMonthly: vi.fn() }));

vi.mock("@/lib/gms-prices/admin-write", () => ({
  recordMonthlyUpdate: mockMonthly,
}));

import { POST } from "@/app/api/admin/gms-prices/[id]/update-prices/route";

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

const CTX = { params: Promise.resolve({ id: "ref-1" }) };

const VALID_BODY = {
  prix_gms_kg: 13.5,
  prix_terroir_kg_min: 17,
  prix_terroir_kg_max: 23,
  prix_terroir_kg_moyen: 20,
  mois_reference: "2026-05",
  source: "Source 2026-05",
  source_url: null,
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  preCheckResp = { data: { id: "ref-1" }, error: null };
  mockMonthly
    .mockReset()
    .mockResolvedValue({ ok: true, data: { history_recorded: true } });
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/gms-prices/[id]/update-prices", () => {
  it("non-admin → 403", async () => {
    sessionUser = null;
    const res = await POST(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(403);
    expect(mockMonthly).not.toHaveBeenCalled();
  });

  it("prix négatif → 400", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, prix_gms_kg: -1 }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  it("mois_reference mauvais format → 400", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, mois_reference: "mai 2026" }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  it("ID inexistant → 404", async () => {
    preCheckResp = { data: null, error: null };
    const res = await POST(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(404);
    expect(mockMonthly).not.toHaveBeenCalled();
  });

  it("succès complet (history_recorded=true) → 200 + flag propagé", async () => {
    const res = await POST(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "ref-1",
      history_recorded: true,
    });
    expect(mockMonthly).toHaveBeenCalledOnce();
    const [, id, input, adminId] = mockMonthly.mock.calls[0];
    expect(id).toBe("ref-1");
    expect(input.prix_gms_kg).toBe(13.5);
    expect(input.mois_reference).toBe("2026-05");
    expect(adminId).toBe("admin-1");
  });

  it("live OK + history fail → 200 + history_recorded=false (flag propagé)", async () => {
    mockMonthly.mockResolvedValue({
      ok: true,
      data: { history_recorded: false },
    });
    const res = await POST(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "ref-1",
      history_recorded: false,
    });
  });

  it("UPDATE live fail → 500 + error", async () => {
    mockMonthly.mockResolvedValue({ ok: false, error: "live update fail" });
    const res = await POST(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "live update fail" });
  });
});

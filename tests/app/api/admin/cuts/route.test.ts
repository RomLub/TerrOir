import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests POST + GET /api/admin/cuts — focus sur les comportements spécifiques
// aux cuts (validation animal_id UUID + filter ?animal_id sur GET list).
// Auth/audit pattern identique à categories/animals (déjà couvert).

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

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

const { mockList, mockCreate, mockLog } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock("@/lib/products/admin/cuts", () => ({
  listCuts: mockList,
  createCut: mockCreate,
}));

vi.mock("@/lib/audit-logs/log-categorisation-event", () => ({
  logCategorisationEvent: mockLog,
}));

import { POST, GET } from "@/app/api/admin/cuts/route";

const ANIMAL_ID = "12345678-1234-1234-1234-123456789012";
const VALID = {
  animal_id: ANIMAL_ID,
  slug: "filet-mignon",
  name: "Filet mignon",
  sort_order: 105,
};

function makeRequest(body: unknown, url = "http://x/api/admin/cuts"): Request {
  return {
    json: async () => body,
    url,
  } as unknown as Request;
}

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockList.mockReset();
  mockCreate.mockReset().mockResolvedValue({ ok: true, data: { id: "new-id" } });
  mockLog.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/cuts", () => {
  it("animal_id manquant → 400", async () => {
    const { animal_id: _drop, ...incomplete } = VALID;
    const res = await POST(makeRequest(incomplete));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("animal_id pas un UUID → 400", async () => {
    const res = await POST(makeRequest({ ...VALID, animal_id: "boeuf" }));
    expect(res.status).toBe(400);
  });

  it("succès → 201 + audit log avec animal_id dans metadata", async () => {
    const res = await POST(makeRequest(VALID));
    expect(res.status).toBe(201);
    expect(mockLog).toHaveBeenCalledOnce();
    const audit = mockLog.mock.calls[0][0];
    expect(audit.eventType).toBe("admin_cut_created");
    expect(audit.metadata.animal_id).toBe(ANIMAL_ID);
    expect(audit.metadata.slug).toBe("filet-mignon");
  });
});

describe("GET /api/admin/cuts", () => {
  beforeEach(() => {
    mockList.mockResolvedValue([]);
  });

  it("sans filtre → list() appelée sans options", async () => {
    await GET(makeRequest(null, "http://x/api/admin/cuts"));
    expect(mockList).toHaveBeenCalledOnce();
    // 2nd arg = filters, doit être undefined
    expect(mockList.mock.calls[0][1]).toBeUndefined();
  });

  it("avec ?animal_id=<uuid> → list() reçoit { animal_id }", async () => {
    await GET(
      makeRequest(null, `http://x/api/admin/cuts?animal_id=${ANIMAL_ID}`),
    );
    expect(mockList.mock.calls[0][1]).toEqual({ animal_id: ANIMAL_ID });
  });

  it("?animal_id non-UUID → 400 (pas d'appel SQL)", async () => {
    const res = await GET(
      makeRequest(null, "http://x/api/admin/cuts?animal_id=boeuf"),
    );
    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(403);
  });
});

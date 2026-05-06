import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AdminCategorisationSlugDuplicate } from "@/lib/products/admin/errors";

// Tests POST + GET /api/admin/categories.
//
// Stratégie : mock les helpers admin + audit log + getSessionUser. Le client
// Supabase n'est jamais touché directement par le code testé (les helpers
// abstrayent tout) — supabase/admin retourne juste un objet vide.

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

vi.mock("@/lib/products/admin/categories", () => ({
  listCategories: mockList,
  createCategory: mockCreate,
}));

vi.mock("@/lib/audit-logs/log-categorisation-event", () => ({
  logCategorisationEvent: mockLog,
}));

import { POST, GET } from "@/app/api/admin/categories/route";

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

const VALID = {
  slug: "fruits",
  name: "Fruits",
  sort_order: 25,
};

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

describe("POST /api/admin/categories", () => {
  it("non authentifié → 403", async () => {
    sessionUser = null;
    const res = await POST(makeRequest(VALID));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("non admin → 403", async () => {
    sessionUser = {
      id: "u",
      email: null,
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await POST(makeRequest(VALID));
    expect(res.status).toBe(403);
  });

  it("body invalide (slug pas kebab-case) → 400", async () => {
    const res = await POST(makeRequest({ ...VALID, slug: "Bad Slug" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("body invalide (sort_order négatif) → 400", async () => {
    const res = await POST(makeRequest({ ...VALID, sort_order: -1 }));
    expect(res.status).toBe(400);
  });

  it("succès → 201 + id retourné + audit log avec metadata", async () => {
    const res = await POST(makeRequest(VALID));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "new-id" });
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockLog).toHaveBeenCalledOnce();
    const audit = mockLog.mock.calls[0][0];
    expect(audit.eventType).toBe("admin_category_created");
    expect(audit.userId).toBe("admin-1");
    expect(audit.metadata).toMatchObject({
      id: "new-id",
      slug: "fruits",
      name: "Fruits",
      sort_order: 25,
    });
  });

  it("slug duplicate → 409 + body { error: 'slug_duplicate', slug }", async () => {
    mockCreate.mockImplementation(() => {
      throw new AdminCategorisationSlugDuplicate("category", "fruits");
    });
    const res = await POST(makeRequest(VALID));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "slug_duplicate",
      slug: "fruits",
    });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("helper retourne ok:false → 500", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "db down" });
    const res = await POST(makeRequest(VALID));
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/categories", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("succès → 200 + rows", async () => {
    mockList.mockResolvedValue([
      { id: "1", slug: "viande", name: "Viande", sort_order: 10 },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].slug).toBe("viande");
  });

  it("helper throw → 500", async () => {
    mockList.mockRejectedValue(new Error("db error"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

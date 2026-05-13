import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
} from "@/lib/products/admin/errors";

// Tests GET / PATCH / DELETE /api/admin/categories/[id].

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

const { mockGet, mockUpdate, mockDelete, mockCount, mockLog } = vi.hoisted(
  () => ({
    mockGet: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockCount: vi.fn(),
    mockLog: vi.fn(),
  }),
);

vi.mock("@/lib/products/admin/categories", () => ({
  getCategory: mockGet,
  updateCategory: mockUpdate,
  deleteCategory: mockDelete,
  countCategoryDependencies: mockCount,
}));

vi.mock("@/lib/audit-logs/log-categorisation-event", () => ({
  logCategorisationEvent: mockLog,
}));

import { GET, PATCH, DELETE } from "@/app/api/admin/categories/[id]/route";

const ID = "cat-uuid-1";
const BEFORE = {
  id: ID,
  slug: "viande",
  name: "Viande",
  sort_order: 10,
};
const VALID_PATCH = {
  slug: "viandes",
  name: "Viandes",
  sort_order: 11,
};

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockGet.mockReset().mockResolvedValue(BEFORE);
  mockUpdate.mockReset().mockResolvedValue({ ok: true, data: null });
  mockDelete.mockReset().mockResolvedValue({ ok: true, data: null });
  mockCount.mockReset().mockResolvedValue({ products: 0 });
  mockLog.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/categories/[id]", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await GET({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(403);
  });

  it("inexistant → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await GET({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(404);
  });

  it("succès → 200 + row + dependencies", async () => {
    mockCount.mockResolvedValue({ products: 3 });
    const res = await GET({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.row.slug).toBe("viande");
    expect(body.dependencies.products).toBe(3);
  });
});

describe("PATCH /api/admin/categories/[id]", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await PATCH(makeRequest(VALID_PATCH), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(403);
  });

  it("body invalide → 400", async () => {
    const res = await PATCH(
      makeRequest({ ...VALID_PATCH, slug: "BAD!" }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(res.status).toBe(400);
  });

  it("inexistant → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await PATCH(makeRequest(VALID_PATCH), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(404);
  });

  it("succès → 200 + audit log avec before/after", async () => {
    const res = await PATCH(makeRequest(VALID_PATCH), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(200);
    expect(mockLog).toHaveBeenCalledOnce();
    const audit = mockLog.mock.calls[0][0];
    expect(audit.eventType).toBe("admin_category_updated");
    expect(audit.userId).toBe("admin-1");
    expect(audit.metadata.before).toEqual({
      slug: "viande",
      name: "Viande",
      sort_order: 10,
    });
    expect(audit.metadata.after).toEqual(VALID_PATCH);
  });

  it("slug duplicate → 409 { error: 'slug_duplicate' }", async () => {
    mockUpdate.mockImplementation(() => {
      throw new AdminCategorisationSlugDuplicate("category", "viandes");
    });
    const res = await PATCH(makeRequest(VALID_PATCH), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "slug_duplicate",
      slug: "viandes",
    });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("helper ok:false → 500, pas d'audit", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: "db" });
    const res = await PATCH(makeRequest(VALID_PATCH), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/categories/[id]", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(403);
  });

  it("inexistant → 404", async () => {
    mockGet.mockResolvedValue(null);
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(404);
  });

  it("succès → 200 + audit avec snapshot avant suppression", async () => {
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(mockLog).toHaveBeenCalledOnce();
    const audit = mockLog.mock.calls[0][0];
    expect(audit.eventType).toBe("admin_category_deleted");
    expect(audit.metadata).toMatchObject({
      id: ID,
      slug: "viande",
      name: "Viande",
    });
  });

  it("delete bloqué (deps > 0) → 409 { error: 'delete_blocked', dependencies }", async () => {
    mockDelete.mockImplementation(() => {
      throw new AdminCategorisationDeleteBlocked("category", { products: 5 });
    });
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("delete_blocked");
    expect(body.dependencies.products).toBe(5);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("helper ok:false → 500, pas d'audit", async () => {
    mockDelete.mockResolvedValue({ ok: false, error: "db" });
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(500);
    expect(mockLog).not.toHaveBeenCalled();
  });
});

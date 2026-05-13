import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AdminCategorisationDeleteBlocked } from "@/lib/products/admin/errors";

// Tests focalisés /api/admin/animals/[id] — seuls les comportements
// spécifiques aux animaux (multi-dépendances products + cuts) justifient
// un fichier séparé. Le pattern auth/Zod/audit est identique à
// /api/admin/categories/[id], couvert par tests/app/api/admin/categories/.

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

const { mockGet, mockDelete, mockCount, mockLog } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockDelete: vi.fn(),
  mockCount: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock("@/lib/products/admin/animals", () => ({
  getAnimal: mockGet,
  updateAnimal: vi.fn(),
  deleteAnimal: mockDelete,
  countAnimalDependencies: mockCount,
}));

vi.mock("@/lib/audit-logs/log-categorisation-event", () => ({
  logCategorisationEvent: mockLog,
}));

import { GET, DELETE } from "@/app/api/admin/animals/[id]/route";

const ID = "animal-uuid-1";
const BEFORE = {
  id: ID,
  slug: "boeuf",
  name: "Bœuf",
  sort_order: 10,
};

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockGet.mockReset().mockResolvedValue(BEFORE);
  mockDelete.mockReset().mockResolvedValue({ ok: true, data: null });
  mockCount.mockReset().mockResolvedValue({ products: 0, cuts: 0 });
  mockLog.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/admin/animals/[id]", () => {
  it("succès → row + dependencies (products ET cuts)", async () => {
    mockCount.mockResolvedValue({ products: 4, cuts: 30 });
    const res = await GET({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dependencies).toEqual({ products: 4, cuts: 30 });
  });
});

describe("DELETE /api/admin/animals/[id] — multi-dépendances", () => {
  it("delete OK si products=0 ET cuts=0", async () => {
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(mockLog).toHaveBeenCalledOnce();
  });

  it("delete BLOQUÉ products only → 409 dependencies.products only", async () => {
    mockDelete.mockImplementation(() => {
      throw new AdminCategorisationDeleteBlocked("animal", {
        products: 3,
        cuts: 0,
      });
    });
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.dependencies).toEqual({ products: 3, cuts: 0 });
  });

  it("delete BLOQUÉ cuts only → 409 dependencies.cuts only", async () => {
    mockDelete.mockImplementation(() => {
      throw new AdminCategorisationDeleteBlocked("animal", {
        products: 0,
        cuts: 30,
      });
    });
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.dependencies).toEqual({ products: 0, cuts: 30 });
  });

  it("delete BLOQUÉ both → 409 dependencies.products ET cuts", async () => {
    mockDelete.mockImplementation(() => {
      throw new AdminCategorisationDeleteBlocked("animal", {
        products: 2,
        cuts: 5,
      });
    });
    const res = await DELETE({} as Request, { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.dependencies).toEqual({ products: 2, cuts: 5 });
    expect(mockLog).not.toHaveBeenCalled();
  });
});

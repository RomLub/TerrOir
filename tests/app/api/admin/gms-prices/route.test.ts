// Tests vitest pour POST /api/admin/gms-prices (création).
//
// Stratégie : mock helpers admin-write + getSessionUser + createSupabaseAdminClient.
// Le helper createGmsPrice fait l'INSERT, donc le mock Supabase est minimal
// (pas de capture chaînée : le helper est mocké directement).

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

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@/lib/gms-prices/admin-write", () => ({
  createGmsPrice: mockCreate,
}));

import { POST } from "@/app/api/admin/gms-prices/route";

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

const VALID_BODY = {
  slug: "test-slug",
  filiere: "bovin",
  libelle: "Test ref",
  description_courte: "desc",
  prix_gms_kg: 12.5,
  prix_terroir_kg_min: 16,
  prix_terroir_kg_max: 22,
  prix_terroir_kg_moyen: 19,
  mois_reference: "2026-04",
  source: "Test source",
  source_url: null,
  ordre_affichage: 1,
  notes_admin: null,
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sessionUser = {
    id: "admin-1",
    email: "admin@example.com",
    roles: [],
    isAdmin: true,
  };
  mockCreate.mockReset().mockResolvedValue({ ok: true, data: { id: "ref-1" } });
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/gms-prices", () => {
  it("auth absente → 403, helper non appelé", async () => {
    sessionUser = null;
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("session non-admin → 403", async () => {
    sessionUser = {
      id: "user-1",
      email: "user@example.com",
      roles: ["consumer"],
      isAdmin: false,
    };
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("body manquant champ obligatoire → 400", async () => {
    const { slug: _slug, ...incomplete } = VALID_BODY;
    const res = await POST(makeRequest(incomplete));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("slug pas en kebab-case → 400", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, slug: "BadSlug!" }));
    expect(res.status).toBe(400);
  });

  it("mois_reference mauvais format → 400", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, mois_reference: "avril 2026" }),
    );
    expect(res.status).toBe(400);
  });

  it("filiere hors enum → 400", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, filiere: "volaille" }));
    expect(res.status).toBe(400);
  });

  it("succès → 201 + id retourné, helper appelé avec session.id", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "ref-1" });
    expect(mockCreate).toHaveBeenCalledOnce();
    const [, input, adminId] = mockCreate.mock.calls[0];
    expect(input.slug).toBe("test-slug");
    expect(adminId).toBe("admin-1");
  });

  it("helper retourne ok:false → 500 + error.message", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "duplicate slug" });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "duplicate slug" });
  });
});

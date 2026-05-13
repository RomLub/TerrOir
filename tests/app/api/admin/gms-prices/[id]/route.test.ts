// Tests vitest pour PUT /api/admin/gms-prices/[id] (update standard).

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

// Mock Supabase admin pour le pré-check 404 (.from().select().eq().maybeSingle()).
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

const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }));

vi.mock("@/lib/gms-prices/admin-write", () => ({
  updateGmsPrice: mockUpdate,
}));

import { PUT } from "@/app/api/admin/gms-prices/[id]/route";

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

const CTX = { params: Promise.resolve({ id: "ref-1" }) };

const VALID_BODY = {
  libelle: "Test updated",
  description_courte: "desc updated",
  source: "Source updated",
  source_url: "https://example.com",
  ordre_affichage: 2,
  notes_admin: "note",
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
  mockUpdate.mockReset().mockResolvedValue({ ok: true, data: null });
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PUT /api/admin/gms-prices/[id]", () => {
  it("non-admin → 403", async () => {
    sessionUser = null;
    const res = await PUT(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("body invalide → 400", async () => {
    const res = await PUT(
      makeRequest({ ...VALID_BODY, libelle: "" }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  it("body source_url non-URL → 400", async () => {
    const res = await PUT(
      makeRequest({ ...VALID_BODY, source_url: "pas-une-url" }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  it("ID inexistant → 404, helper non appelé", async () => {
    preCheckResp = { data: null, error: null };
    const res = await PUT(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("erreur SELECT pré-check → 500 + message générique (F-029)", async () => {
    preCheckResp = { data: null, error: { message: "db down" } };
    const res = await PUT(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(500);
    // F-029 : dbErrorResponse masque le message brut Postgres.
    expect(await res.json()).toEqual({ error: "Internal database error" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("succès → 200 + id, helper appelé avec session.id et params.id", async () => {
    const res = await PUT(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "ref-1" });
    expect(mockUpdate).toHaveBeenCalledOnce();
    const [, id, , adminId] = mockUpdate.mock.calls[0];
    expect(id).toBe("ref-1");
    expect(adminId).toBe("admin-1");
  });

  it("helper update fail → 500 + error", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: "constraint fail" });
    const res = await PUT(makeRequest(VALID_BODY), CTX);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "constraint fail" });
  });

  it("body update n'accepte pas slug ni filiere ni prix (figés A3)", async () => {
    // Champs hors schéma → ignorés par zod (passthrough false par défaut),
    // mais slug/filiere/prix non requis donc le payload reste valide.
    // Ce test vérifie que ces champs ne sont PAS transmis au helper même
    // si l'admin a essayé de les inclure dans le body.
    const sneaky = {
      ...VALID_BODY,
      slug: "hacked",
      filiere: "porcin",
      prix_gms_kg: 999,
      active: false,
    };
    const res = await PUT(makeRequest(sneaky), CTX);
    expect(res.status).toBe(200);
    const [, , input] = mockUpdate.mock.calls[0];
    expect(input.slug).toBeUndefined();
    expect(input.filiere).toBeUndefined();
    expect(input.prix_gms_kg).toBeUndefined();
    expect(input.active).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Chantier 6 — getSessionUser + isSuperAdmin : un admin suspendu n'est plus
// admin ; super_admin actif → isSuperAdmin. Sécu critique (gate des actions).

// Perf (Lot A) : getSessionUser() vérifie la session via auth.getClaims()
// (validation locale du JWT) et non plus getUser(). serverState.claims porte
// la shape des claims (sub→id, email) ; null = pas de session (fail-closed).
const { serverState, adminState } = vi.hoisted(() => ({
  serverState: {
    claims: { sub: "u1", email: "a@x.fr", iat: 1_700_000_000 } as
      | { sub: string; email?: string; iat: number }
      | null,
    usersData: null as unknown,
    adminData: null as unknown,
  },
  adminState: { data: null as unknown, isCalls: [] as Array<{ col: string; val: unknown }> },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () =>
        serverState.claims
          ? { data: { claims: serverState.claims }, error: null }
          : { data: null, error: null },
    },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () =>
        Promise.resolve({
          data: table === "users" ? serverState.usersData : serverState.adminData,
          error: null,
        });
      return b;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.is = (col: string, val: unknown) => {
        adminState.isCalls.push({ col, val });
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: adminState.data, error: null });
      return b;
    },
  }),
}));

import { getSessionUser, isSuperAdmin, isAdmin } from "@/lib/auth/session";

beforeEach(() => {
  serverState.claims = { sub: "u1", email: "a@x.fr", iat: 1_700_000_000 };
  serverState.usersData = null;
  serverState.adminData = null;
  adminState.data = null;
  adminState.isCalls = [];
});

describe("getSessionUser — admin / super_admin / suspendu (chantier 6)", () => {
  it("super_admin actif → isAdmin + isSuperAdmin", async () => {
    serverState.adminData = { id: "u1", admin_privilege: "super_admin", suspended_at: null };
    const s = await getSessionUser();
    expect(s?.isAdmin).toBe(true);
    expect(s?.isSuperAdmin).toBe(true);
  });

  it("admin standard actif → isAdmin sans isSuperAdmin", async () => {
    serverState.adminData = { id: "u1", admin_privilege: "standard", suspended_at: null };
    const s = await getSessionUser();
    expect(s?.isAdmin).toBe(true);
    expect(s?.isSuperAdmin).toBe(false);
  });

  it("admin suspendu → PAS isAdmin", async () => {
    serverState.adminData = {
      id: "u1",
      admin_privilege: "super_admin",
      suspended_at: "2026-05-20T10:00:00Z",
    };
    const s = await getSessionUser();
    expect(s?.isAdmin).toBe(false);
    expect(s?.isSuperAdmin).toBe(false);
  });

  it("non-admin → ni isAdmin ni isSuperAdmin", async () => {
    serverState.usersData = { roles: ["consumer"] };
    serverState.adminData = null;
    const s = await getSessionUser();
    expect(s?.isAdmin).toBe(false);
    expect(s?.isSuperAdmin).toBe(false);
    expect(s?.roles).toEqual(["consumer"]);
  });
});

describe("getSessionUser — vérification via getClaims (Lot A)", () => {
  it("mappe claims.sub→id et claims.email→email dans SessionUser", async () => {
    serverState.claims = {
      sub: "u-42",
      email: "bob@example.com",
      iat: 1_700_000_000,
    };
    serverState.usersData = { roles: ["consumer"] };
    const s = await getSessionUser();
    expect(s?.id).toBe("u-42");
    expect(s?.email).toBe("bob@example.com");
  });

  it("claims sans email → email = null (jamais undefined)", async () => {
    serverState.claims = { sub: "u-1", iat: 1_700_000_000 };
    serverState.usersData = { roles: ["consumer"] };
    const s = await getSessionUser();
    expect(s?.email).toBeNull();
  });

  it("fail-closed : pas de claims (JWT invalide/absent) → null", async () => {
    serverState.claims = null;
    const s = await getSessionUser();
    expect(s).toBeNull();
  });
});

describe("isSuperAdmin(userId)", () => {
  it("super_admin actif → true", async () => {
    adminState.data = { admin_privilege: "super_admin", suspended_at: null };
    expect(await isSuperAdmin("u1")).toBe(true);
  });

  it("super_admin suspendu → false", async () => {
    adminState.data = { admin_privilege: "super_admin", suspended_at: "2026-05-20T10:00:00Z" };
    expect(await isSuperAdmin("u1")).toBe(false);
  });

  it("standard → false", async () => {
    adminState.data = { admin_privilege: "standard", suspended_at: null };
    expect(await isSuperAdmin("u1")).toBe(false);
  });

  it("non-admin → false", async () => {
    adminState.data = null;
    expect(await isSuperAdmin("u1")).toBe(false);
  });
});

describe("isAdmin(userId) helper — filtre suspended_at au niveau requête", () => {
  it("applique .is('suspended_at', null) (un admin suspendu est exclu côté DB)", async () => {
    adminState.data = { id: "u1" };
    const res = await isAdmin("u1");
    expect(res).toBe(true);
    // Le filtre suspended_at IS NULL est bien appliqué dans la requête.
    expect(adminState.isCalls).toContainEqual({ col: "suspended_at", val: null });
  });

  it("aucune ligne (suspendu filtré ou non-admin) → false", async () => {
    adminState.data = null;
    expect(await isAdmin("u1")).toBe(false);
    expect(adminState.isCalls).toContainEqual({ col: "suspended_at", val: null });
  });
});

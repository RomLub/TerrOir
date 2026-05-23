import { describe, it, expect, vi, beforeEach } from "vitest";

// Chantier 6 — getSessionUser + isSuperAdmin : un admin suspendu n'est plus
// admin ; super_admin actif → isSuperAdmin. Sécu critique (gate des actions).

const { serverState, adminState } = vi.hoisted(() => ({
  serverState: {
    user: { id: "u1", email: "a@x.fr" } as { id: string; email: string } | null,
    usersData: null as unknown,
    adminData: null as unknown,
  },
  adminState: { data: null as unknown },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: serverState.user }, error: null }) },
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
      b.maybeSingle = () => Promise.resolve({ data: adminState.data, error: null });
      return b;
    },
  }),
}));

import { getSessionUser, isSuperAdmin } from "@/lib/auth/session";

beforeEach(() => {
  serverState.user = { id: "u1", email: "a@x.fr" };
  serverState.usersData = null;
  serverState.adminData = null;
  adminState.data = null;
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

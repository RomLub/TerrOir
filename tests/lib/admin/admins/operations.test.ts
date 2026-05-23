import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests de l'orchestration des opérations admin (chantier 6) : mapping du
// résultat RPC, résolution email (promote), et déclenchement email + audit
// sur succès uniquement. Les gardes métier (forbidden/self/last super) sont
// testées au niveau RPC (smoke prod) ; ici on teste le câblage TS.

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
});

const { state, sendTemplateMock, auditMock } = vi.hoisted(() => ({
  state: {
    usersData: null as unknown,
    adminUsersData: null as unknown,
    rpc: { data: { ok: true } as unknown, error: null as unknown },
    rpcCalls: [] as Array<{ fn: string; params: unknown }>,
  },
  sendTemplateMock: vi.fn(async () => ({ ok: true, id: "x" })),
  auditMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.ilike = () => b;
      b.eq = () => b;
      b.maybeSingle = () =>
        Promise.resolve({
          data: table === "users" ? state.usersData : state.adminUsersData,
          error: null,
        });
      return b;
    },
    rpc: (fn: string, params: unknown) => {
      state.rpcCalls.push({ fn, params });
      return Promise.resolve(state.rpc);
    },
  }),
}));

vi.mock("@/lib/resend/send", () => ({ sendTemplate: sendTemplateMock }));
vi.mock("@/lib/audit-logs/log-admin-lifecycle-event", () => ({
  logAdminLifecycleEvent: auditMock,
}));

import {
  promoteAdminByEmail,
  suspendAdmin,
  revokeAdmin,
  setAdminPrivilege,
  reactivateAdmin,
  adminOpMessage,
} from "@/lib/admin/admins/operations";

const ACTOR = "478d643a-9d2a-485d-aedf-438ca2eda246";

beforeEach(() => {
  state.usersData = null;
  state.adminUsersData = null;
  state.rpc = { data: { ok: true }, error: null };
  state.rpcCalls = [];
  sendTemplateMock.mockClear();
  auditMock.mockClear();
});

describe("adminOpMessage", () => {
  it("mappe les codes connus + fallback interne", () => {
    expect(adminOpMessage("self_action")).toMatch(/vous-même/);
    expect(adminOpMessage("last_super_admin")).toMatch(/super-administrateur/);
    expect(adminOpMessage("no_account")).toMatch(/s'inscrire comme client/);
    expect(adminOpMessage("zzz_unknown")).toBe(adminOpMessage("internal"));
  });
});

describe("promoteAdminByEmail", () => {
  it("aucun compte → no_account (RPC non appelée, pas d'email)", async () => {
    state.usersData = null;
    state.adminUsersData = null;
    const res = await promoteAdminByEmail(ACTOR, "ghost@x.fr");
    expect(res).toEqual({ ok: false, errorCode: "no_account" });
    expect(state.rpcCalls).toHaveLength(0);
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it("email déjà admin → already_admin", async () => {
    state.usersData = null;
    state.adminUsersData = { id: "a1" };
    const res = await promoteAdminByEmail(ACTOR, "admin@x.fr");
    expect(res).toEqual({ ok: false, errorCode: "already_admin" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("succès → RPC admin_promote_user + email promoted + audit", async () => {
    state.usersData = { id: "u1", email: "u1@x.fr", prenom: "Léa" };
    state.rpc = { data: { ok: true }, error: null };
    const res = await promoteAdminByEmail(ACTOR, "u1@x.fr", "super_admin");
    expect(res).toEqual({ ok: true });
    expect(state.rpcCalls[0]).toEqual({
      fn: "admin_promote_user",
      params: { p_actor: ACTOR, p_target: "u1", p_privilege: "super_admin" },
    });
    expect(sendTemplateMock).toHaveBeenCalledOnce();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "admin_promoted", userId: ACTOR }),
    );
  });

  it("RPC refuse (has_client_activity) → pas d'email", async () => {
    state.usersData = { id: "u1", email: "u1@x.fr", prenom: "Léa" };
    state.rpc = { data: { ok: false, error_code: "has_client_activity" }, error: null };
    const res = await promoteAdminByEmail(ACTOR, "u1@x.fr");
    expect(res).toEqual({ ok: false, errorCode: "has_client_activity" });
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });
});

describe("opérations sur un admin existant", () => {
  beforeEach(() => {
    state.adminUsersData = { email: "target@x.fr", prenom: "Max" };
  });

  it("suspendAdmin succès → RPC admin_suspend + email suspended + audit", async () => {
    const res = await suspendAdmin(ACTOR, "t1");
    expect(res).toEqual({ ok: true });
    expect(state.rpcCalls[0]).toEqual({
      fn: "admin_suspend",
      params: { p_actor: ACTOR, p_target: "t1" },
    });
    expect(sendTemplateMock).toHaveBeenCalledOnce();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "admin_suspended" }),
    );
  });

  it("revokeAdmin succès → RPC admin_revoke + email revoked + audit", async () => {
    const res = await revokeAdmin(ACTOR, "t1");
    expect(res).toEqual({ ok: true });
    expect(state.rpcCalls[0].fn).toBe("admin_revoke");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "admin_revoked" }),
    );
  });

  it("reactivateAdmin succès → email reactivated + audit", async () => {
    await reactivateAdmin(ACTOR, "t1");
    expect(state.rpcCalls[0].fn).toBe("admin_reactivate");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "admin_reactivated" }),
    );
  });

  it("setAdminPrivilege succès → RPC admin_set_privilege + audit (new_privilege)", async () => {
    const res = await setAdminPrivilege(ACTOR, "t1", "standard");
    expect(res).toEqual({ ok: true });
    expect(state.rpcCalls[0]).toEqual({
      fn: "admin_set_privilege",
      params: { p_actor: ACTOR, p_target: "t1", p_privilege: "standard" },
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "admin_privilege_changed",
        metadata: expect.objectContaining({ new_privilege: "standard" }),
      }),
    );
  });

  it("RPC refuse (self_action) → pas d'email ni audit", async () => {
    state.rpc = { data: { ok: false, error_code: "self_action" }, error: null };
    const res = await suspendAdmin(ACTOR, ACTOR);
    expect(res).toEqual({ ok: false, errorCode: "self_action" });
    expect(sendTemplateMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchAdminInvitationsList,
  mapRowStatus,
} from "@/lib/admin/invitations/fetch";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tests fetchAdminInvitationsList — helper service_role qui factorise la
// query producer_invitations + count exact + jointure admin_users.email +
// computed status pour la page admin /invitations (chantier PR3
// feature/admin-new-surfaces).
//
// IMPORTANT — la table n'a pas de colonne `status`. Le filtre côté UI est
// traduit en conditions SQL équivalentes (is/not/gte/lt) qu'on vérifie ici
// via le mock chainable.

type Resp = { data?: unknown; error?: unknown; count?: number | null };
type Call = {
  op: string;
  col?: string;
  val?: unknown;
  val2?: unknown;
};

// Simulateur Supabase chainable. Capture les appels (.select, .is, .not,
// .gte, .lte, .lt, .order, .limit) pour assertions sur les filtres SQL
// appliqués. 2 builders distincts (items / count) consommés dans l'ordre
// d'appel de .from() (cohérent fetch.test.ts producers).
function makeAdminMock(opts: {
  itemsResp: Resp;
  countResp: Resp;
}): { admin: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const nextResp: Resp[] = [opts.itemsResp, opts.countResp];

  const makeBuilder = (resp: Resp) => {
    const builder: Record<string, unknown> = {};
    builder.select = (...args: unknown[]) => {
      calls.push({ op: "select", val: args });
      return builder;
    };
    builder.is = (col: string, val: unknown) => {
      calls.push({ op: "is", col, val });
      return builder;
    };
    builder.not = (col: string, op: string, val: unknown) => {
      calls.push({ op: "not", col, val: op, val2: val });
      return builder;
    };
    builder.gte = (col: string, val: unknown) => {
      calls.push({ op: "gte", col, val });
      return builder;
    };
    builder.lte = (col: string, val: unknown) => {
      calls.push({ op: "lte", col, val });
      return builder;
    };
    builder.lt = (col: string, val: unknown) => {
      calls.push({ op: "lt", col, val });
      return builder;
    };
    builder.or = (filters: string) => {
      calls.push({ op: "or", val: filters });
      return builder;
    };
    builder.order = (col: string, ordOpts: unknown) => {
      calls.push({ op: "order", col, val: ordOpts });
      return builder;
    };
    builder.limit = (n: number) => {
      calls.push({ op: "limit", val: n });
      return Promise.resolve(resp);
    };
    // Count query : awaité direct (pas de .limit).
    builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
    return builder;
  };

  const admin = {
    from: () => makeBuilder(nextResp.shift() ?? { data: null, error: null }),
  } as unknown as SupabaseClient;

  return { admin, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =========================================================================
// 1. mapRowStatus — précédence des statuts computed
// =========================================================================

describe("mapRowStatus", () => {
  const now = new Date("2026-05-13T12:00:00Z");

  it("used_at IS NULL + expires_at futur + revoked_at IS NULL → sent", () => {
    expect(
      mapRowStatus(
        {
          used_at: null,
          expires_at: "2026-05-20T00:00:00Z",
          revoked_at: null,
        },
        now,
      ),
    ).toBe("sent");
  });

  it("used_at IS NOT NULL → consumed", () => {
    expect(
      mapRowStatus(
        {
          used_at: "2026-05-12T08:00:00Z",
          expires_at: "2026-05-20T00:00:00Z",
          revoked_at: null,
        },
        now,
      ),
    ).toBe("consumed");
  });

  it("used_at IS NULL + expires_at passé → expired", () => {
    expect(
      mapRowStatus(
        {
          used_at: null,
          expires_at: "2026-05-01T00:00:00Z",
          revoked_at: null,
        },
        now,
      ),
    ).toBe("expired");
  });

  it("revoked_at IS NOT NULL + used_at IS NULL → revoked", () => {
    expect(
      mapRowStatus(
        {
          used_at: null,
          expires_at: "2026-05-20T00:00:00Z",
          revoked_at: "2026-05-13T10:00:00Z",
        },
        now,
      ),
    ).toBe("revoked");
  });

  it("defensive : row avec used_at ET revoked_at (CHECK violé historique) → consumed gagne", () => {
    expect(
      mapRowStatus(
        {
          used_at: "2026-05-12T08:00:00Z",
          expires_at: "2026-05-20T00:00:00Z",
          revoked_at: "2026-05-13T10:00:00Z",
        },
        now,
      ),
    ).toBe("consumed");
  });
});

// =========================================================================
// 2. fetchAdminInvitationsList — filtres SQL traduits
// =========================================================================

describe("fetchAdminInvitationsList — filtre status", () => {
  const baseOpts = {
    cursor: { before: null, beforeId: null },
    from: null,
    to: null,
    now: new Date("2026-05-13T12:00:00Z"),
  };

  it("status='sent' applique .is(used_at,null) + .gte(expires_at,now) + .is(revoked_at,null) sur items ET count", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminInvitationsList(admin, { ...baseOpts, status: "sent" });

    const isUsed = calls.filter(
      (c) => c.op === "is" && c.col === "used_at" && c.val === null,
    );
    const gteExpires = calls.filter(
      (c) => c.op === "gte" && c.col === "expires_at",
    );
    const isRevoked = calls.filter(
      (c) => c.op === "is" && c.col === "revoked_at" && c.val === null,
    );
    // Appliqué 2 fois (items + count).
    expect(isUsed).toHaveLength(2);
    expect(gteExpires).toHaveLength(2);
    expect(isRevoked).toHaveLength(2);
    // La valeur passée à gte est l'ISO de baseOpts.now.
    expect(gteExpires[0]?.val).toBe(baseOpts.now.toISOString());
  });

  it("status='consumed' applique .not(used_at,is,null) sur items ET count", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminInvitationsList(admin, {
      ...baseOpts,
      status: "consumed",
    });
    const notUsed = calls.filter(
      (c) =>
        c.op === "not" &&
        c.col === "used_at" &&
        c.val === "is" &&
        c.val2 === null,
    );
    expect(notUsed).toHaveLength(2);
  });

  it("status='expired' applique .is(used_at,null) + .lt(expires_at,now) + .is(revoked_at,null) sur items ET count", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminInvitationsList(admin, { ...baseOpts, status: "expired" });

    const isUsed = calls.filter(
      (c) => c.op === "is" && c.col === "used_at" && c.val === null,
    );
    const ltExpires = calls.filter(
      (c) => c.op === "lt" && c.col === "expires_at",
    );
    const isRevoked = calls.filter(
      (c) => c.op === "is" && c.col === "revoked_at" && c.val === null,
    );
    expect(isUsed).toHaveLength(2);
    expect(ltExpires).toHaveLength(2);
    expect(isRevoked).toHaveLength(2);
  });

  it("status='revoked' applique .not(revoked_at,is,null) + .is(used_at,null) sur items ET count", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminInvitationsList(admin, { ...baseOpts, status: "revoked" });

    const notRevoked = calls.filter(
      (c) =>
        c.op === "not" &&
        c.col === "revoked_at" &&
        c.val === "is" &&
        c.val2 === null,
    );
    const isUsed = calls.filter(
      (c) => c.op === "is" && c.col === "used_at" && c.val === null,
    );
    expect(notRevoked).toHaveLength(2);
    expect(isUsed).toHaveLength(2);
  });

  it("status='all' n'applique aucun filtre status (ni is ni not sur used_at/revoked_at)", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminInvitationsList(admin, { ...baseOpts, status: "all" });

    const statusRelated = calls.filter(
      (c) =>
        (c.col === "used_at" || c.col === "revoked_at" || c.col === "expires_at") &&
        (c.op === "is" || c.op === "not" || c.op === "gte" || c.op === "lt"),
    );
    expect(statusRelated).toHaveLength(0);
  });
});

// =========================================================================
// 3. fetchAdminInvitationsList — filtres date + cursor + mapping + erreurs
// =========================================================================

describe("fetchAdminInvitationsList — divers", () => {
  const baseOpts = {
    cursor: { before: null, beforeId: null },
    status: "all" as const,
    from: null,
    to: null,
    now: new Date("2026-05-13T12:00:00Z"),
  };

  it("filtres date from/to traduits en .gte/.lte sur created_at", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminInvitationsList(admin, {
      ...baseOpts,
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-13T23:59:59.999Z",
    });

    const gteCreated = calls.filter(
      (c) => c.op === "gte" && c.col === "created_at",
    );
    const lteCreated = calls.filter(
      (c) => c.op === "lte" && c.col === "created_at",
    );
    expect(gteCreated).toHaveLength(2);
    expect(gteCreated[0]?.val).toBe("2026-05-01T00:00:00.000Z");
    expect(lteCreated).toHaveLength(2);
    expect(lteCreated[0]?.val).toBe("2026-05-13T23:59:59.999Z");
  });

  it("cursor parsé → .or() PostgREST appliqué sur items uniquement (pas count)", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminInvitationsList(admin, {
      ...baseOpts,
      cursor: {
        before: "2026-05-10T00:00:00Z",
        beforeId: "11111111-1111-1111-1111-111111111111",
      },
    });
    const ors = calls.filter((c) => c.op === "or");
    expect(ors).toHaveLength(1);
    expect(String(ors[0]?.val)).toContain("created_at.lt.2026-05-10");
    expect(String(ors[0]?.val)).toContain(
      "id.lt.11111111-1111-1111-1111-111111111111",
    );
  });

  it("mapping raw → AdminInvitationRow : applique mapRowStatus + flatten creator + champs ISO", async () => {
    const { admin } = makeAdminMock({
      itemsResp: {
        data: [
          {
            id: "inv1",
            email: "p1@example.com",
            expires_at: "2026-05-20T00:00:00Z",
            used_at: null,
            revoked_at: null,
            created_at: "2026-05-13T10:00:00Z",
            created_by: "admin-1",
            creator: { email: "admin@terroir.fr" },
          },
          {
            id: "inv2",
            email: "p2@example.com",
            expires_at: "2026-05-01T00:00:00Z",
            used_at: null,
            revoked_at: null,
            created_at: "2026-04-25T10:00:00Z",
            created_by: null,
            // Forme alternative array (compat ascendante Supabase joints).
            creator: [{ email: "admin2@terroir.fr" }],
          },
        ],
        error: null,
      },
      countResp: { count: 2, error: null },
    });
    const res = await fetchAdminInvitationsList(admin, {
      ...baseOpts,
      status: "all",
    });
    expect(res.error).toBeNull();
    expect(res.total).toBe(2);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      id: "inv1",
      email: "p1@example.com",
      status: "sent",
      createdByEmail: "admin@terroir.fr",
    });
    expect(res.rows[1]).toMatchObject({
      id: "inv2",
      status: "expired",
      createdByEmail: "admin2@terroir.fr",
    });
  });

  it("nextCursor exposé uniquement si data.length === PAGE_SIZE (50)", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `inv-${i}`,
      email: `p${i}@example.com`,
      expires_at: "2026-05-20T00:00:00Z",
      used_at: null,
      revoked_at: null,
      created_at: `2026-05-${(13 - (i % 10)).toString().padStart(2, "0")}T10:00:00Z`,
      created_by: null,
      creator: null,
    }));
    const { admin } = makeAdminMock({
      itemsResp: { data: rows, error: null },
      countResp: { count: 200, error: null },
    });
    const res = await fetchAdminInvitationsList(admin, baseOpts);
    expect(res.nextCursor).not.toBeNull();
    expect(res.nextCursor?.id).toBe("inv-49");
  });

  it("nextCursor null si data.length < PAGE_SIZE", async () => {
    const { admin } = makeAdminMock({
      itemsResp: {
        data: [
          {
            id: "inv1",
            email: "p1@example.com",
            expires_at: "2026-05-20T00:00:00Z",
            used_at: null,
            revoked_at: null,
            created_at: "2026-05-13T10:00:00Z",
            created_by: null,
            creator: null,
          },
        ],
        error: null,
      },
      countResp: { count: 1, error: null },
    });
    const res = await fetchAdminInvitationsList(admin, baseOpts);
    expect(res.nextCursor).toBeNull();
  });

  it("itemsRes.error → renvoie error.message + rows vide", async () => {
    const { admin } = makeAdminMock({
      itemsResp: { data: null, error: { message: "boom items" } },
      countResp: { count: 0, error: null },
    });
    const res = await fetchAdminInvitationsList(admin, baseOpts);
    expect(res.error).toBe("boom items");
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("countRes.error → renvoie error.message", async () => {
    const { admin } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: null, error: { message: "boom count" } },
    });
    const res = await fetchAdminInvitationsList(admin, baseOpts);
    expect(res.error).toBe("boom count");
  });
});

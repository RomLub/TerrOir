import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAdminProducersList } from "@/lib/admin/producers/fetch";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tests fetchAdminProducersList — helper service_role qui factorise la query
// producers + count exact + jointure users.email pour la page admin.

type Resp = { data?: unknown; error?: unknown; count?: number | null };

// Simulateur Supabase chainable. On capture les eq/neq/order/limit pour
// vérifier les filtres SQL appliqués (notamment .neq('statut', 'draft')
// et .neq('statut', 'deleted') gated par includeDraftsAndDeleted=false).
function makeAdminMock(opts: {
  itemsResp: Resp;
  countResp: Resp;
}): { admin: SupabaseClient; calls: Array<{ op: string; col?: string; val?: unknown }> } {
  const calls: Array<{ op: string; col?: string; val?: unknown }> = [];

  // 2 builders distincts (items/count) consumés dans l'ordre d'appel .from()
  let nextResp: Resp[] = [opts.itemsResp, opts.countResp];

  const makeBuilder = (resp: Resp) => {
    const builder: Record<string, unknown> = {};
    builder.select = (...args: unknown[]) => {
      calls.push({ op: "select", val: args });
      return builder;
    };
    builder.neq = (col: string, val: unknown) => {
      calls.push({ op: "neq", col, val });
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      calls.push({ op: "eq", col, val });
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
    builder.order = (col: string, opts: unknown) => {
      calls.push({ op: "order", col, val: opts });
      return builder;
    };
    builder.limit = (n: number) => {
      calls.push({ op: "limit", val: n });
      // L'items query est awaitée directement → thenable.
      return Promise.resolve(resp);
    };
    // Le count query n'utilise pas .limit, awaité direct depuis .neq() ou
    // .select(...) selon les filtres. On expose un .then pour qu'il soit
    // thenable lui aussi.
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

describe("fetchAdminProducersList", () => {
  it("includeDraftsAndDeleted=false : exclut draft + deleted via .neq", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: false,
    });
    const neqStatutCalls = calls.filter(
      (c) => c.op === "neq" && c.col === "statut",
    );
    // 2 .neq sur items + 2 .neq sur count = 4 calls statut au total
    expect(neqStatutCalls.length).toBe(4);
    const vals = neqStatutCalls.map((c) => c.val);
    expect(vals).toContain("draft");
    expect(vals).toContain("deleted");
  });

  it("includeDraftsAndDeleted=true : aucun .neq sur statut", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: true,
    });
    const neqStatutCalls = calls.filter(
      (c) => c.op === "neq" && c.col === "statut",
    );
    expect(neqStatutCalls.length).toBe(0);
  });

  it("cursor renseigné → applique .or avec created_at + tie-breaker id", async () => {
    const { admin, calls } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    await fetchAdminProducersList(admin, {
      cursor: { before: "2026-01-01T00:00:00Z", beforeId: "abc" },
      includeDraftsAndDeleted: false,
    });
    const orCalls = calls.filter((c) => c.op === "or");
    expect(orCalls).toHaveLength(1);
    const filter = orCalls[0].val as string;
    expect(filter).toContain("created_at.lt.2026-01-01T00:00:00Z");
    expect(filter).toContain("and(created_at.eq.2026-01-01T00:00:00Z");
    expect(filter).toContain("id.lt.abc");
  });

  it("mappe la jointure user (email/prenom/nom/telephone) + city/plan/joinedAt formatés", async () => {
    const rawRow = {
      id: "p1",
      slug: "ma-ferme",
      nom_exploitation: "Ma Ferme",
      commune: "Le Mans",
      code_postal: "72000",
      statut: "active",
      abonnement_niveau: "pro",
      created_at: "2026-01-15T12:00:00Z",
      user_id: "user-1",
      user: {
        email: "ma-ferme@example.com",
        prenom: "Jean",
        nom: "Dupont",
        telephone: "0612345678",
      },
    };
    const { admin } = makeAdminMock({
      itemsResp: { data: [rawRow], error: null },
      countResp: { count: 1, error: null },
    });
    const res = await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: false,
    });
    expect(res.error).toBeNull();
    expect(res.total).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "p1",
      slug: "ma-ferme",
      name: "Ma Ferme",
      city: "Le Mans (72)",
      status: "active",
      plan: "Pro",
      email: "ma-ferme@example.com",
      contactName: "Jean Dupont",
      phone: "0612345678",
      userId: "user-1",
    });
  });

  it("contactName='—' + phone=null quand prenom/nom/telephone absents", async () => {
    const rawRow = {
      id: "p3",
      slug: "f3",
      nom_exploitation: "F3",
      commune: "Sablé",
      code_postal: "72300",
      statut: "active",
      abonnement_niveau: "pro",
      created_at: "2026-01-15T12:00:00Z",
      user_id: "user-3",
      user: { email: "f3@y.fr", prenom: null, nom: null, telephone: null },
    };
    const { admin } = makeAdminMock({
      itemsResp: { data: [rawRow], error: null },
      countResp: { count: 1, error: null },
    });
    const res = await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: false,
    });
    expect(res.rows[0].contactName).toBe("—");
    expect(res.rows[0].phone).toBeNull();
  });

  it("supporte la jointure user retournée en array (compat client supabase)", async () => {
    const rawRow = {
      id: "p2",
      slug: "f2",
      nom_exploitation: "F2",
      commune: null,
      code_postal: null,
      statut: "pending",
      abonnement_niveau: null,
      created_at: "2026-01-15T12:00:00Z",
      user_id: null,
      user: [{ email: "x@y.fr", prenom: "Marie", nom: null, telephone: "0700000000" }],
    };
    const { admin } = makeAdminMock({
      itemsResp: { data: [rawRow], error: null },
      countResp: { count: 1, error: null },
    });
    const res = await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: false,
    });
    expect(res.rows[0].email).toBe("x@y.fr");
    expect(res.rows[0].contactName).toBe("Marie");
    expect(res.rows[0].phone).toBe("0700000000");
    expect(res.rows[0].city).toBe("—");
    expect(res.rows[0].plan).toBe("—");
    expect(res.rows[0].userId).toBeNull();
  });

  it("items error → result.error renseigné, rows vide, total 0", async () => {
    const { admin } = makeAdminMock({
      itemsResp: { data: null, error: { message: "boom" } },
      countResp: { count: 0, error: null },
    });
    const res = await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: false,
    });
    expect(res.error).toBe("boom");
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.nextCursor).toBeNull();
  });

  it("count error → result.error renseigné même si items OK", async () => {
    const { admin } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: null, error: { message: "count failed" } },
    });
    const res = await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: false,
    });
    expect(res.error).toBe("count failed");
  });

  it("nextCursor null quand < 100 rows", async () => {
    const { admin } = makeAdminMock({
      itemsResp: { data: [], error: null },
      countResp: { count: 0, error: null },
    });
    const res = await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: false,
    });
    expect(res.nextCursor).toBeNull();
  });

  it("nextCursor exposé quand exactement 100 rows (dernière page)", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      slug: `s${i}`,
      nom_exploitation: `F${i}`,
      commune: null,
      code_postal: null,
      statut: "active",
      abonnement_niveau: null,
      created_at: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`,
      user_id: null,
      user: null,
    }));
    const { admin } = makeAdminMock({
      itemsResp: { data: rows, error: null },
      countResp: { count: 250, error: null },
    });
    const res = await fetchAdminProducersList(admin, {
      cursor: { before: null, beforeId: null },
      includeDraftsAndDeleted: false,
    });
    expect(res.nextCursor).not.toBeNull();
    expect(res.nextCursor?.id).toBe("p99");
    expect(res.total).toBe(250);
  });
});

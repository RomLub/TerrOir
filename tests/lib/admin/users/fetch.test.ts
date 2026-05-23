import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchAdminUsersList,
  fetchAdminUserDetail,
  fetchAdminUserOrders,
  fetchAdminUserReviews,
  fetchAdminUserNotifications,
} from "@/lib/admin/users/fetch";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tests vitest pour les 5 helpers service_role qui factorisent les queries
// admin /users (PR3 admin-new-surfaces). Pattern aligne lib/admin/producers/
// fetch.test.ts (PR1) : simulateur chainable Supabase qui capture les
// op+col+val, builders FIFO consumes via from().

type Resp = { data?: unknown; error?: unknown; count?: number | null };

type Call = { op: string; col?: string; val?: unknown; schema?: string };

// Simulateur chainable. On supporte .from(), .schema().from(), .select(),
// .eq(), .neq(), .ilike(), .in(), .not(), .contains(), .or(), .order(),
// .limit(), .maybeSingle(). Les builders sont consumes FIFO depuis nextResps.
function makeAdminMock(opts: { responses: Resp[] }): {
  admin: SupabaseClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const nextResps = [...opts.responses];
  let currentSchema = "public";

  const makeBuilder = (resp: Resp) => {
    const builder: Record<string, unknown> = {};
    builder.select = (...args: unknown[]) => {
      calls.push({ op: "select", val: args, schema: currentSchema });
      return builder;
    };
    builder.eq = (col: string, val: unknown) => {
      calls.push({ op: "eq", col, val });
      return builder;
    };
    builder.neq = (col: string, val: unknown) => {
      calls.push({ op: "neq", col, val });
      return builder;
    };
    builder.ilike = (col: string, val: unknown) => {
      calls.push({ op: "ilike", col, val });
      return builder;
    };
    builder.in = (col: string, val: unknown) => {
      calls.push({ op: "in", col, val });
      return builder;
    };
    builder.not = (col: string, op: string, val: unknown) => {
      calls.push({ op: `not.${op}`, col, val });
      return builder;
    };
    builder.contains = (col: string, val: unknown) => {
      calls.push({ op: "contains", col, val });
      return builder;
    };
    builder.or = (filters: string) => {
      calls.push({ op: "or", val: filters });
      return builder;
    };
    builder.lt = (col: string, val: unknown) => {
      calls.push({ op: "lt", col, val });
      return builder;
    };
    builder.order = (col: string, o: unknown) => {
      calls.push({ op: "order", col, val: o });
      return builder;
    };
    builder.limit = (n: number) => {
      calls.push({ op: "limit", val: n });
      return Promise.resolve(resp);
    };
    builder.maybeSingle = () => {
      calls.push({ op: "maybeSingle" });
      return Promise.resolve(resp);
    };
    builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
    return builder;
  };

  const admin = {
    from: () => makeBuilder(nextResps.shift() ?? { data: null, error: null }),
    schema: (name: string) => {
      currentSchema = name;
      return {
        from: () => {
          const r = makeBuilder(nextResps.shift() ?? { data: null, error: null });
          // Restore schema apres consommation du builder.
          currentSchema = "public";
          return r;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { admin, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══ fetchAdminUsersList ═══════════════════════════════════════════════════

describe("fetchAdminUsersList", () => {
  it("happy path : mappe roles[] vers role 'producer' quand contains producer", async () => {
    const rawRow = {
      id: "u1",
      email: "lead@example.com",
      prenom: "Jean",
      nom: "Dupont",
      roles: ["consumer", "producer"],
      created_at: "2026-01-15T12:00:00Z",
    };
    const { admin } = makeAdminMock({
      responses: [
        // 1. items query
        { data: [rawRow], error: null },
        // 2. count query
        { count: 1, error: null },
        // 3. admin_users jointure (empty)
        { data: [], error: null },
        // 4. auth.users jointure
        { data: [{ id: "u1", last_sign_in_at: "2026-02-01T10:00:00Z" }], error: null },
        // 5. orders count
        { data: [{ consumer_id: "u1" }, { consumer_id: "u1" }], error: null },
      ],
    });
    const res = await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "all",
      q: null,
    });
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "u1",
      email: "lead@example.com",
      fullName: "Jean Dupont",
      role: "producer",
      lastSignInAt: "2026-02-01T10:00:00Z",
      ordersCount: 2,
    });
    expect(res.total).toBe(1);
  });

  it("role consumer (par defaut, sans roles producer) -> role='consumer'", async () => {
    const rawRow = {
      id: "u2",
      email: "alice@example.com",
      prenom: null,
      nom: null,
      roles: ["consumer"],
      created_at: "2026-01-15T12:00:00Z",
    };
    const { admin } = makeAdminMock({
      responses: [
        { data: [rawRow], error: null },
        { count: 1, error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ],
    });
    const res = await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "all",
      q: null,
    });
    expect(res.rows[0].role).toBe("consumer");
    expect(res.rows[0].fullName).toBe("—");
    expect(res.rows[0].ordersCount).toBe(0);
    expect(res.rows[0].lastSignInAt).toBeNull();
  });

  it("admin_users contient l'id -> role='admin' (override producer)", async () => {
    // admin_users a la colonne `id` (FK row-as-PK vers auth.users.id),
    // pas de colonne `user_id` séparée.
    const rawRow = {
      id: "u3",
      email: "admin@example.com",
      prenom: "Admin",
      nom: null,
      roles: ["consumer", "producer"],
      created_at: "2026-01-15T12:00:00Z",
    };
    const { admin } = makeAdminMock({
      responses: [
        { data: [rawRow], error: null },
        { count: 1, error: null },
        { data: [{ id: "u3" }], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ],
    });
    const res = await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "all",
      q: null,
    });
    expect(res.rows[0].role).toBe("admin");
  });

  it("roleFilter='admin' -> bout-en-bout filtre les non-admins et marque l'user admin (régression PR #130 user_id→id)", async () => {
    // Régression PR #130 : admin_users.PK = `id` (FK row-as-PK vers
    // auth.users.id), pas `user_id`. Le code doit lire `id` et filtrer
    // `users.id IN (admin_ids)`. Si on lisait `user_id` (inexistant), le
    // lookup renverrait `undefined` partout → ids vides → return early
    // rows:[], et la jointure secondaire pour `deriveRole` mapperait sur
    // un Set vide → role='consumer' au lieu de 'admin'.
    //
    // Ordre des `.from()` (FIFO mock) quand roleFilter='admin' :
    //   1. users (items)        — créé avant tout filtre
    //   2. users (count)
    //   3. admin_users (lookup filter)
    //   4. admin_users (jointure secondaire deriveRole)
    //   5. auth.users (last_sign_in)
    //   6. orders
    const rawRow = {
      id: "a1",
      email: "admin@example.com",
      prenom: null,
      nom: null,
      roles: ["consumer"],
      created_at: "2026-01-15T12:00:00Z",
    };
    const { admin } = makeAdminMock({
      responses: [
        { data: [rawRow], error: null },
        { count: 1, error: null },
        { data: [{ id: "a1" }], error: null },
        { data: [{ id: "a1" }], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ],
    });
    const res = await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "admin",
      q: null,
    });
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    // Sans le fix user_id→id, deriveRole tombait sur adminSet vide → 'consumer'.
    expect(res.rows[0].role).toBe("admin");
  });

  it("roleFilter='producer' -> .contains('roles', ['producer'])", async () => {
    const { admin, calls } = makeAdminMock({
      responses: [
        { data: [], error: null },
        { count: 0, error: null },
      ],
    });
    await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "producer",
      q: null,
    });
    const containsCalls = calls.filter((c) => c.op === "contains");
    expect(containsCalls.length).toBeGreaterThanOrEqual(2); // items + count
    expect(containsCalls[0].col).toBe("roles");
    expect(containsCalls[0].val).toEqual(["producer"]);
  });

  it("roleFilter='consumer' -> .not('roles', 'cs', '{producer}')", async () => {
    const { admin, calls } = makeAdminMock({
      responses: [
        { data: [], error: null },
        { count: 0, error: null },
      ],
    });
    await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "consumer",
      q: null,
    });
    const notCalls = calls.filter((c) => c.op === "not.cs");
    expect(notCalls.length).toBeGreaterThanOrEqual(2);
    expect(notCalls[0].col).toBe("roles");
    expect(notCalls[0].val).toBe("{producer}");
  });

  it("roleFilter='consumer_inclusive' (chantier 5) -> .contains('roles', ['consumer'])", async () => {
    const { admin, calls } = makeAdminMock({
      responses: [
        { data: [], error: null },
        { count: 0, error: null },
      ],
    });
    await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "consumer_inclusive",
      q: null,
    });
    const containsCalls = calls.filter((c) => c.op === "contains");
    expect(containsCalls.length).toBeGreaterThanOrEqual(2); // items + count
    expect(containsCalls[0].col).toBe("roles");
    expect(containsCalls[0].val).toEqual(["consumer"]);
    // Pas de négation `.not` (syntaxe éprouvée, double-rôle inclus).
    expect(calls.filter((c) => c.op === "not.cs")).toHaveLength(0);
  });

  it("roleFilter='admin' avec admin_users vide -> rows vides sans erreur", async () => {
    const { admin } = makeAdminMock({
      responses: [
        // admin_users query (consummed before items/count quand roleFilter=admin)
        { data: [], error: null },
      ],
    });
    const res = await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "admin",
      q: null,
    });
    expect(res.rows).toEqual([]);
    expect(res.error).toBeNull();
  });

  it("q non vide -> .ilike sur email avec %term% lowercase + escape", async () => {
    const { admin, calls } = makeAdminMock({
      responses: [
        { data: [], error: null },
        { count: 0, error: null },
      ],
    });
    await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "all",
      q: "FOO_BAR",
    });
    const ilikeCalls = calls.filter((c) => c.op === "ilike");
    expect(ilikeCalls.length).toBeGreaterThanOrEqual(2);
    // toLowerCase + escape `_` -> "foo\_bar" entoure de %
    expect(ilikeCalls[0].val).toBe("%foo\\_bar%");
  });

  it("items error -> result.error renseigne, rows vide", async () => {
    const { admin } = makeAdminMock({
      responses: [
        { data: null, error: { message: "boom" } },
        { count: 0, error: null },
      ],
    });
    const res = await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "all",
      q: null,
    });
    expect(res.error).toBe("boom");
    expect(res.rows).toEqual([]);
  });

  it("count error -> result.error renseigne", async () => {
    const { admin } = makeAdminMock({
      responses: [
        { data: [], error: null },
        { count: null, error: { message: "count failed" } },
      ],
    });
    const res = await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "all",
      q: null,
    });
    expect(res.error).toBe("count failed");
  });

  it("auth.users join error -> fail-safe (rows OK, lastSignInAt=null)", async () => {
    const rawRow = {
      id: "u1",
      email: "x@y.fr",
      prenom: null,
      nom: null,
      roles: ["consumer"],
      created_at: "2026-01-15T12:00:00Z",
    };
    const { admin } = makeAdminMock({
      responses: [
        { data: [rawRow], error: null },
        { count: 1, error: null },
        { data: [], error: null },
        { data: null, error: { message: "auth rls" } },
        { data: [], error: null },
      ],
    });
    const res = await fetchAdminUsersList(admin, {
      cursor: { before: null, beforeId: null },
      roleFilter: "all",
      q: null,
    });
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].lastSignInAt).toBeNull();
  });
});

// ═══ fetchAdminUserDetail ══════════════════════════════════════════════════

describe("fetchAdminUserDetail", () => {
  it("happy path : agrege public.users + auth.users + admin_users", async () => {
    const { admin } = makeAdminMock({
      responses: [
        {
          data: {
            id: "u1",
            email: "x@y.fr",
            prenom: "Jean",
            nom: "Dupont",
            telephone: "+33600000000",
            sms_optin: true,
            roles: ["consumer", "producer"],
            created_at: "2026-01-15T12:00:00Z",
          },
          error: null,
        },
        {
          data: {
            last_sign_in_at: "2026-02-01T10:00:00Z",
            email_confirmed_at: "2026-01-15T12:01:00Z",
            phone_confirmed_at: null,
          },
          error: null,
        },
        { data: null, error: null }, // pas admin
      ],
    });
    const res = await fetchAdminUserDetail(admin, "u1");
    expect(res.error).toBeNull();
    expect(res.user).toMatchObject({
      id: "u1",
      email: "x@y.fr",
      role: "producer",
      smsOptin: true,
      lastSignInAt: "2026-02-01T10:00:00Z",
      emailConfirmedAt: "2026-01-15T12:01:00Z",
      phoneConfirmedAt: null,
    });
  });

  it("user introuvable -> retourne user=null, error=null", async () => {
    const { admin } = makeAdminMock({
      responses: [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });
    const res = await fetchAdminUserDetail(admin, "u404");
    expect(res.user).toBeNull();
    expect(res.error).toBeNull();
  });

  it("erreur public.users -> error renseigne, user=null", async () => {
    const { admin } = makeAdminMock({
      responses: [
        { data: null, error: { message: "rls denied" } },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });
    const res = await fetchAdminUserDetail(admin, "u1");
    expect(res.error).toBe("rls denied");
    expect(res.user).toBeNull();
  });

  it("auth.users miss (tombstone) -> last_sign_in_at=null mais user expose", async () => {
    const { admin } = makeAdminMock({
      responses: [
        {
          data: {
            id: "u1",
            email: "x@y.fr",
            prenom: null,
            nom: null,
            telephone: null,
            sms_optin: null,
            roles: ["consumer"],
            created_at: "2026-01-15T12:00:00Z",
          },
          error: null,
        },
        { data: null, error: null }, // auth miss
        { data: null, error: null },
      ],
    });
    const res = await fetchAdminUserDetail(admin, "u1");
    expect(res.user).not.toBeNull();
    expect(res.user?.lastSignInAt).toBeNull();
  });

  it("admin_users present -> role='admin'", async () => {
    // admin_users.id (FK row-as-PK vers auth.users.id) — pas de colonne
    // `user_id` séparée. Régression PR #130 corrigée.
    const { admin } = makeAdminMock({
      responses: [
        {
          data: {
            id: "u1",
            email: "x@y.fr",
            prenom: null,
            nom: null,
            telephone: null,
            sms_optin: null,
            roles: ["consumer"],
            created_at: "2026-01-15T12:00:00Z",
          },
          error: null,
        },
        { data: null, error: null },
        { data: { id: "u1" }, error: null },
      ],
    });
    const res = await fetchAdminUserDetail(admin, "u1");
    expect(res.user?.role).toBe("admin");
  });
});

// ═══ fetchAdminUserOrders ══════════════════════════════════════════════════

describe("fetchAdminUserOrders", () => {
  it("mappe producer.nom_exploitation + montant_total -> number", async () => {
    const { admin, calls } = makeAdminMock({
      responses: [
        {
          data: [
            {
              id: "o1",
              code_commande: "ABC123",
              created_at: "2026-02-01T12:00:00Z",
              statut: "completed",
              montant_total: "42.50",
              producer: { nom_exploitation: "Ferme A" },
            },
          ],
          error: null,
        },
      ],
    });
    const res = await fetchAdminUserOrders(admin, "u1");
    expect(res.error).toBeNull();
    expect(res.orders).toHaveLength(1);
    expect(res.orders[0]).toMatchObject({
      id: "o1",
      codeCommande: "ABC123",
      statut: "completed",
      montantTotal: 42.5,
      producerName: "Ferme A",
    });
    // filtre consumer_id
    const eqCalls = calls.filter((c) => c.op === "eq");
    expect(eqCalls[0].col).toBe("consumer_id");
    expect(eqCalls[0].val).toBe("u1");
  });

  it("producer en array (compat client supabase) -> normalise", async () => {
    const { admin } = makeAdminMock({
      responses: [
        {
          data: [
            {
              id: "o1",
              code_commande: null,
              created_at: "2026-02-01T12:00:00Z",
              statut: null,
              montant_total: null,
              producer: [{ nom_exploitation: "Ferme B" }],
            },
          ],
          error: null,
        },
      ],
    });
    const res = await fetchAdminUserOrders(admin, "u1");
    expect(res.orders[0].producerName).toBe("Ferme B");
    expect(res.orders[0].statut).toBe("—");
    expect(res.orders[0].montantTotal).toBeNull();
  });

  it("erreur -> orders=[], error renseigne", async () => {
    const { admin } = makeAdminMock({
      responses: [{ data: null, error: { message: "boom" } }],
    });
    const res = await fetchAdminUserOrders(admin, "u1");
    expect(res.orders).toEqual([]);
    expect(res.error).toBe("boom");
  });
});

// ═══ fetchAdminUserReviews ═════════════════════════════════════════════════

describe("fetchAdminUserReviews", () => {
  it("tronque commentaire > 200 chars + suffixe ellipsis", async () => {
    const long = "x".repeat(250);
    const { admin } = makeAdminMock({
      responses: [
        {
          data: [
            {
              id: "r1",
              created_at: "2026-02-01T12:00:00Z",
              note: 4,
              statut: "published",
              commentaire: long,
              producer: { nom_exploitation: "Ferme A" },
            },
          ],
          error: null,
        },
      ],
    });
    const res = await fetchAdminUserReviews(admin, "u1");
    expect(res.reviews[0].commentaireExcerpt.endsWith("…")).toBe(true);
    expect(res.reviews[0].commentaireExcerpt.length).toBe(201);
  });

  it("commentaire null -> excerpt = '—'", async () => {
    const { admin } = makeAdminMock({
      responses: [
        {
          data: [
            {
              id: "r1",
              created_at: "2026-02-01T12:00:00Z",
              note: null,
              statut: null,
              commentaire: null,
              producer: null,
            },
          ],
          error: null,
        },
      ],
    });
    const res = await fetchAdminUserReviews(admin, "u1");
    expect(res.reviews[0].commentaireExcerpt).toBe("—");
    expect(res.reviews[0].producerName).toBe("—");
    expect(res.reviews[0].note).toBeNull();
  });

  it("erreur -> reviews=[], error renseigne", async () => {
    const { admin } = makeAdminMock({
      responses: [{ data: null, error: { message: "rls" } }],
    });
    const res = await fetchAdminUserReviews(admin, "u1");
    expect(res.reviews).toEqual([]);
    expect(res.error).toBe("rls");
  });
});

// ═══ fetchAdminUserNotifications ═══════════════════════════════════════════

describe("fetchAdminUserNotifications", () => {
  it("tri created_at DESC + filtre user_id", async () => {
    const { admin, calls } = makeAdminMock({
      responses: [{ data: [], error: null }],
    });
    await fetchAdminUserNotifications(admin, "u1");
    const orderCalls = calls.filter((c) => c.op === "order");
    expect(orderCalls.length).toBe(1);
    expect(orderCalls[0].col).toBe("created_at");
    expect(orderCalls[0].val).toEqual({ ascending: false });
    const eqCalls = calls.filter((c) => c.op === "eq");
    expect(eqCalls[0].col).toBe("user_id");
    expect(eqCalls[0].val).toBe("u1");
  });

  it("mappe type->channel, statut->status, template, metadata.subject", async () => {
    const { admin } = makeAdminMock({
      responses: [
        {
          data: [
            {
              id: "n1",
              created_at: "2026-02-01T12:00:00Z",
              type: "email",
              statut: "sent",
              template: "order_confirmed_producer",
              metadata: { subject: "Votre commande" },
            },
          ],
          error: null,
        },
      ],
    });
    const res = await fetchAdminUserNotifications(admin, "u1");
    expect(res.notifications[0]).toMatchObject({
      id: "n1",
      channel: "email",
      status: "sent",
      template: "order_confirmed_producer",
      subjectExcerpt: "Votre commande",
    });
  });

  it("metadata sans subject -> excerpt='—'", async () => {
    const { admin } = makeAdminMock({
      responses: [
        {
          data: [
            {
              id: "n1",
              created_at: "2026-02-01T12:00:00Z",
              type: "sms",
              statut: "failed",
              template: "sms_new_order_producer",
              metadata: null,
            },
          ],
          error: null,
        },
      ],
    });
    const res = await fetchAdminUserNotifications(admin, "u1");
    expect(res.notifications[0].subjectExcerpt).toBe("—");
    expect(res.notifications[0].status).toBe("failed");
  });

  it("erreur -> notifications=[], error renseigne", async () => {
    const { admin } = makeAdminMock({
      responses: [{ data: null, error: { message: "rls" } }],
    });
    const res = await fetchAdminUserNotifications(admin, "u1");
    expect(res.notifications).toEqual([]);
    expect(res.error).toBe("rls");
  });
});

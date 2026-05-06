// Tests vitest pour lib/legal/compliance.ts.
//
// Stratégie : mock createSupabaseAdminClient pour intercepter les calls
// chainables `.from().select().eq()...`. Les tests asserent à la fois la
// logique pure (computeCGUStatus avec edge cases NULL/version) et le
// shaping output (status calculé, pagination, count).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
});

type Resp = {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
};

const { mockAdminFrom } = vi.hoisted(() => ({
  mockAdminFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockAdminFrom }),
}));

import {
  computeCGUStatus,
  getUserCGUStatus,
  listUsersWithCGUStatus,
  getCGUComplianceStats,
} from "@/lib/legal/compliance";

beforeEach(() => {
  mockAdminFrom.mockReset();
});

// Helper : crée un builder chainable qui résout sur `resp` au .then ou
// au .maybeSingle, et capture les filtres posés via `capture`.
function makeBuilder(resp: Resp) {
  const filters: Record<string, unknown> = {};
  let rangeArgs: [number, number] | null = null;
  let selectArgs: { cols: string; opts?: unknown } | null = null;
  const builder: Record<string, unknown> = {};
  const proxy: ProxyHandler<typeof builder> = {
    get(target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop in target) return target[prop];
      // Catch-all chainable methods : retourne builder lui-même par défaut.
      return (...args: unknown[]) => {
        if (prop === "select") {
          selectArgs = { cols: args[0] as string, opts: args[1] };
          return wrapped;
        }
        if (prop === "maybeSingle") return Promise.resolve(resp);
        if (prop === "then") {
          const onResolve = args[0] as (v: Resp) => unknown;
          return Promise.resolve(resp).then(onResolve);
        }
        if (prop === "range") {
          rangeArgs = args as unknown as [number, number];
          return wrapped;
        }
        if (prop === "is" || prop === "eq" || prop === "neq") {
          filters[`${String(prop)}:${args[0]}`] = args[1];
          return wrapped;
        }
        if (prop === "not") {
          filters[`not:${args[0]}:${args[1]}`] = args[2] ?? null;
          return wrapped;
        }
        if (prop === "ilike") {
          filters[`ilike:${args[0]}`] = args[1];
          return wrapped;
        }
        if (prop === "order") {
          filters[`order:${args[0]}`] = args[1];
          return wrapped;
        }
        return wrapped;
      };
    },
  };
  const wrapped: typeof builder = new Proxy(builder, proxy);
  return {
    builder: wrapped,
    getFilters: () => filters,
    getRange: () => rangeArgs,
    getSelect: () => selectArgs,
  };
}

describe("computeCGUStatus", () => {
  it("never_accepted quand acceptedAt = NULL", () => {
    const out = computeCGUStatus(null, null);
    expect(out.status).toBe("never_accepted");
    expect(out.acceptedAt).toBeNull();
    expect(out.acceptedVersion).toBeNull();
    expect(out.currentVersion).toBe(LEGAL_VERSIONS.CGU);
    expect(out.daysSinceAcceptance).toBeNull();
  });

  it("never_accepted quand acceptedAt présent mais version NULL", () => {
    const out = computeCGUStatus("2026-01-01T00:00:00Z", null);
    expect(out.status).toBe("never_accepted");
  });

  it("accepted_current quand version = LEGAL_VERSIONS.CGU", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    const out = computeCGUStatus(
      "2026-05-01T12:00:00Z",
      LEGAL_VERSIONS.CGU,
      now,
    );
    expect(out.status).toBe("accepted_current");
    expect(out.acceptedVersion).toBe(LEGAL_VERSIONS.CGU);
    expect(out.daysSinceAcceptance).toBe(5);
  });

  it("accepted_outdated quand version != LEGAL_VERSIONS.CGU", () => {
    const out = computeCGUStatus("2026-01-01T00:00:00Z", "0.9");
    expect(out.status).toBe("accepted_outdated");
    expect(out.acceptedVersion).toBe("0.9");
  });

  it("daysSinceAcceptance = 0 quand acceptation aujourd'hui", () => {
    const now = new Date("2026-05-06T12:00:00Z");
    const out = computeCGUStatus(
      "2026-05-06T08:00:00Z",
      LEGAL_VERSIONS.CGU,
      now,
    );
    expect(out.daysSinceAcceptance).toBe(0);
  });
});

describe("getUserCGUStatus", () => {
  it("retourne null si user introuvable", async () => {
    mockAdminFrom.mockReturnValue(
      makeBuilder({ data: null, error: null }).builder,
    );
    const result = await getUserCGUStatus("00000000-0000-4000-8000-000000000000");
    expect(result).toBeNull();
  });

  it("retourne le statut calculé pour un user existant", async () => {
    mockAdminFrom.mockReturnValue(
      makeBuilder({
        data: {
          cgu_accepted_at: "2026-05-06T08:00:00Z",
          cgu_version: LEGAL_VERSIONS.CGU,
        },
        error: null,
      }).builder,
    );
    const result = await getUserCGUStatus(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(result?.status).toBe("accepted_current");
    expect(result?.acceptedVersion).toBe(LEGAL_VERSIONS.CGU);
  });

  it("propage erreur DB", async () => {
    mockAdminFrom.mockReturnValue(
      makeBuilder({ data: null, error: { message: "boom" } }).builder,
    );
    await expect(
      getUserCGUStatus("11111111-1111-4111-8111-111111111111"),
    ).rejects.toMatchObject({ message: "boom" });
  });
});

describe("listUsersWithCGUStatus", () => {
  it("status=never_accepted pose le filtre is(cgu_accepted_at, null)", async () => {
    const harness = makeBuilder({
      data: [
        {
          id: "u1",
          email: "old@example.com",
          prenom: "Romain",
          nom: "L",
          created_at: "2026-01-01T00:00:00Z",
          cgu_accepted_at: null,
          cgu_version: null,
        },
      ],
      error: null,
      count: 11,
    });
    mockAdminFrom.mockReturnValue(harness.builder);

    const result = await listUsersWithCGUStatus({ status: "never_accepted" });

    expect(harness.getFilters()["is:cgu_accepted_at"]).toBeNull();
    expect(result.users).toHaveLength(1);
    expect(result.users[0]?.status).toBe("never_accepted");
    expect(result.users[0]?.email).toBe("old@example.com");
    expect(result.total).toBe(11);
  });

  it("status=accepted_current pose eq(cgu_version, current)", async () => {
    const harness = makeBuilder({ data: [], error: null, count: 0 });
    mockAdminFrom.mockReturnValue(harness.builder);

    await listUsersWithCGUStatus({ status: "accepted_current" });
    expect(harness.getFilters()["eq:cgu_version"]).toBe(LEGAL_VERSIONS.CGU);
  });

  it("status=accepted_outdated pose not(cgu_accepted_at is null) + neq(cgu_version, current)", async () => {
    const harness = makeBuilder({ data: [], error: null, count: 0 });
    mockAdminFrom.mockReturnValue(harness.builder);

    await listUsersWithCGUStatus({ status: "accepted_outdated" });
    expect(harness.getFilters()["not:cgu_accepted_at:is"]).toBeNull();
    expect(harness.getFilters()["neq:cgu_version"]).toBe(LEGAL_VERSIONS.CGU);
  });

  it("status=all : aucun filtre status", async () => {
    const harness = makeBuilder({ data: [], error: null, count: 0 });
    mockAdminFrom.mockReturnValue(harness.builder);

    await listUsersWithCGUStatus({ status: "all" });
    const f = harness.getFilters();
    expect(f["is:cgu_accepted_at"]).toBeUndefined();
    expect(f["eq:cgu_version"]).toBeUndefined();
    expect(f["neq:cgu_version"]).toBeUndefined();
  });

  it("search applique ilike avec wildcards %%", async () => {
    const harness = makeBuilder({ data: [], error: null, count: 0 });
    mockAdminFrom.mockReturnValue(harness.builder);

    await listUsersWithCGUStatus({ search: "rOmAin" });
    expect(harness.getFilters()["ilike:email"]).toBe("%rOmAin%");
  });

  it("search échappe % et _ pour empêcher pattern injection", async () => {
    const harness = makeBuilder({ data: [], error: null, count: 0 });
    mockAdminFrom.mockReturnValue(harness.builder);

    await listUsersWithCGUStatus({ search: "ad%min_user" });
    expect(harness.getFilters()["ilike:email"]).toBe(
      "%ad\\%min\\_user%",
    );
  });

  it("pagination : limit + offset → range [offset, offset+limit-1]", async () => {
    const harness = makeBuilder({ data: [], error: null, count: 200 });
    mockAdminFrom.mockReturnValue(harness.builder);

    const result = await listUsersWithCGUStatus({ limit: 25, offset: 50 });
    expect(harness.getRange()).toEqual([50, 74]);
    expect(result.page).toBe(3);
    expect(result.totalPages).toBe(8);
  });

  it("pagination défaut : limit=50, offset=0", async () => {
    const harness = makeBuilder({ data: [], error: null, count: 0 });
    mockAdminFrom.mockReturnValue(harness.builder);

    const result = await listUsersWithCGUStatus();
    expect(harness.getRange()).toEqual([0, 49]);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it("totalPages=1 quand total=0 (pas de division par zéro)", async () => {
    const harness = makeBuilder({ data: [], error: null, count: 0 });
    mockAdminFrom.mockReturnValue(harness.builder);

    const result = await listUsersWithCGUStatus({ status: "accepted_outdated" });
    expect(result.totalPages).toBe(1);
    expect(result.total).toBe(0);
  });

  it("propage erreur DB", async () => {
    const harness = makeBuilder({
      data: null,
      error: { message: "db down" },
      count: null,
    });
    mockAdminFrom.mockReturnValue(harness.builder);

    await expect(listUsersWithCGUStatus()).rejects.toMatchObject({
      message: "db down",
    });
  });
});

describe("getCGUComplianceStats", () => {
  it("retourne les 4 counts (total, never, current, outdated)", async () => {
    // 4 calls successifs, chacun retourne un count différent. mockAdminFrom
    // ne distingue pas les calls — on séquence avec mockImplementation
    // qui retourne un nouveau builder à chaque appel.
    const counts = [42, 11, 31, 0];
    let i = 0;
    mockAdminFrom.mockImplementation(() => {
      const c = counts[i++] ?? 0;
      return makeBuilder({ data: null, error: null, count: c }).builder;
    });

    const stats = await getCGUComplianceStats();
    expect(stats.total).toBe(42);
    expect(stats.neverAccepted).toBe(11);
    expect(stats.acceptedCurrent).toBe(31);
    expect(stats.acceptedOutdated).toBe(0);
  });

  it("propage erreur DB sur l'un des 4 counts", async () => {
    let i = 0;
    mockAdminFrom.mockImplementation(() => {
      const isThird = i++ === 2;
      return makeBuilder({
        data: null,
        error: isThird ? { message: "boom" } : null,
        count: 0,
      }).builder;
    });

    await expect(getCGUComplianceStats()).rejects.toMatchObject({
      message: "boom",
    });
  });
});

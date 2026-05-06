// Tests vitest pour fetch-coverage-departments.
//
// Stratégie : on teste fetchCoverageDepartmentsRaw (variante exposée pour les
// tests, bypass unstable_cache Next.js qui n'est pas trivial à instancier
// en environnement vitest sans plumberie supplémentaire).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { mockClientHolder } = vi.hoisted(() => ({
  mockClientHolder: { current: null as SupabaseClient | null },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockClientHolder.current!,
}));

import { fetchCoverageDepartmentsRaw } from "@/lib/products/fetch-coverage-departments";

type Resp = { data?: unknown; error?: unknown };

function buildClient(rows: Array<{ code_postal: string | null }>, error: { message: string } | null = null): SupabaseClient {
  return {
    from: (_table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.is = () =>
        Promise.resolve({
          data: error ? null : rows,
          error: error ?? null,
        } as Resp);
      return builder;
    },
  } as unknown as SupabaseClient;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchCoverageDepartmentsRaw", () => {
  it("aggrège correctement par 2 premiers chiffres du code postal", async () => {
    mockClientHolder.current = buildClient([
      { code_postal: "72100" },
      { code_postal: "72200" }, // même département 72
      { code_postal: "49000" },
      { code_postal: "61000" },
    ]);

    const res = await fetchCoverageDepartmentsRaw();

    expect(res.totalProducers).toBe(4);
    expect(res.totalDepartments).toBe(3);
    expect(res.coveredDepartments).toEqual(["49", "61", "72"]);
    expect(res.departmentProducerCounts).toEqual({
      "72": 2,
      "49": 1,
      "61": 1,
    });
  });

  it("Corse : 200xx/201xx → 2A, 202xx-206xx → 2B", async () => {
    mockClientHolder.current = buildClient([
      { code_postal: "20000" }, // 2A
      { code_postal: "20100" }, // 2A
      { code_postal: "20200" }, // 2B
      { code_postal: "20600" }, // 2B
    ]);

    const res = await fetchCoverageDepartmentsRaw();
    expect(res.departmentProducerCounts).toEqual({
      "2A": 2,
      "2B": 2,
    });
    expect(res.coveredDepartments).toEqual(["2A", "2B"]);
  });

  it("ignore les code_postal null/vides", async () => {
    mockClientHolder.current = buildClient([
      { code_postal: null },
      { code_postal: "" },
      { code_postal: "72100" },
    ]);

    const res = await fetchCoverageDepartmentsRaw();
    expect(res.totalProducers).toBe(1);
    expect(res.coveredDepartments).toEqual(["72"]);
  });

  it("payload vide (aucun producer public) → résultat vide", async () => {
    mockClientHolder.current = buildClient([]);

    const res = await fetchCoverageDepartmentsRaw();
    expect(res).toEqual({
      coveredDepartments: [],
      departmentProducerCounts: {},
      totalProducers: 0,
      totalDepartments: 0,
    });
  });

  it("erreur Supabase → fail-safe avec résultat vide + console.error", async () => {
    mockClientHolder.current = buildClient([], { message: "db down" });

    const res = await fetchCoverageDepartmentsRaw();
    expect(res).toEqual({
      coveredDepartments: [],
      departmentProducerCounts: {},
      totalProducers: 0,
      totalDepartments: 0,
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("DOM : 97x/98x renvoyés tels quels (3 char) — pas dans le hexgrid mais comptés", async () => {
    mockClientHolder.current = buildClient([
      { code_postal: "97400" }, // Réunion
      { code_postal: "98800" }, // Nouvelle-Calédonie
      { code_postal: "72100" },
    ]);

    const res = await fetchCoverageDepartmentsRaw();
    expect(res.departmentProducerCounts).toEqual({
      "974": 1,
      "988": 1,
      "72": 1,
    });
  });
});

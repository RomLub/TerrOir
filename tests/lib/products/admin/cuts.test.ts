import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  listCuts,
  getCut,
  countCutDependencies,
  createCut,
  updateCut,
  deleteCut,
} from "@/lib/products/admin/cuts";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
} from "@/lib/products/admin/errors";
import { MockBus, silenceConsole } from "./_supabase-mock";

const ID = "cut-uuid-1";
const ANIMAL_ID = "animal-uuid-boeuf";

let bus: MockBus;
let consoles: ReturnType<typeof silenceConsole>;

beforeEach(() => {
  bus = new MockBus();
  consoles = silenceConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listCuts", () => {
  it("sans filtre → SELECT brut, pas de eq sur animal_id", async () => {
    bus.push("cuts", "select", {
      data: [
        {
          id: "1",
          animal_id: ANIMAL_ID,
          slug: "joue",
          name: "Joue",
          sort_order: 10,
        },
      ],
      error: null,
    });
    const rows = await listCuts(bus.buildClient());
    expect(rows).toHaveLength(1);
    // Aucun eq car pas de filtre fourni
    expect(bus.captured.eqs).toEqual([]);
  });

  it("filtre par animal_id → eq appelé", async () => {
    bus.push("cuts", "select", { data: [], error: null });
    await listCuts(bus.buildClient(), { animal_id: ANIMAL_ID });
    expect(bus.captured.eqs).toContainEqual({
      table: "cuts",
      col: "animal_id",
      val: ANIMAL_ID,
    });
  });

  it("DB error → throw", async () => {
    bus.push("cuts", "select", {
      data: null,
      error: { message: "db down" },
    });
    await expect(listCuts(bus.buildClient())).rejects.toThrow("db down");
  });
});

describe("getCut", () => {
  it("retourne null si non trouvé", async () => {
    bus.push("cuts", "select", { data: null, error: null });
    const row = await getCut(bus.buildClient(), ID);
    expect(row).toBeNull();
  });
});

describe("countCutDependencies", () => {
  it("compte products via cut_id", async () => {
    bus.push("products", "select-count", { count: 7, error: null });
    const deps = await countCutDependencies(bus.buildClient(), ID);
    expect(deps.products).toBe(7);
    expect(bus.captured.eqs).toContainEqual({
      table: "products",
      col: "cut_id",
      val: ID,
    });
  });

  it("count=null → 0", async () => {
    bus.push("products", "select-count", { count: null, error: null });
    const deps = await countCutDependencies(bus.buildClient(), ID);
    expect(deps.products).toBe(0);
  });
});

describe("createCut", () => {
  it("succès → ok:true + id, payload contient animal_id+slug+name+sort_order", async () => {
    bus.push("cuts", "insert", { data: { id: ID }, error: null });
    const res = await createCut(bus.buildClient(), {
      animal_id: ANIMAL_ID,
      slug: "filet-mignon",
      name: "Filet mignon",
      sort_order: 105,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(ID);
    const payload = bus.captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.animal_id).toBe(ANIMAL_ID);
    expect(payload.slug).toBe("filet-mignon");
    expect(payload.name).toBe("Filet mignon");
    expect(payload.sort_order).toBe(105);
  });

  it("slug duplicate scoped par animal_id → throw", async () => {
    bus.push("cuts", "insert", {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "cuts_animal_id_slug_key"',
      },
    });
    let thrown: unknown = null;
    try {
      await createCut(bus.buildClient(), {
        animal_id: ANIMAL_ID,
        slug: "joue",
        name: "Joue dup",
        sort_order: 0,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AdminCategorisationSlugDuplicate);
    if (thrown instanceof AdminCategorisationSlugDuplicate) {
      expect(thrown.slug).toBe("joue");
      expect(thrown.resource).toBe("cut");
    }
  });
});

describe("updateCut", () => {
  it("succès → ok:true, eq sur id", async () => {
    bus.push("cuts", "update", { data: null, error: null });
    const res = await updateCut(bus.buildClient(), ID, {
      animal_id: ANIMAL_ID,
      slug: "joue",
      name: "Joue",
      sort_order: 10,
    });
    expect(res.ok).toBe(true);
    expect(bus.captured.eqs).toContainEqual({
      table: "cuts",
      col: "id",
      val: ID,
    });
  });

  it("slug duplicate sur update → throw", async () => {
    bus.push("cuts", "update", {
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    await expect(
      updateCut(bus.buildClient(), ID, {
        animal_id: ANIMAL_ID,
        slug: "joue",
        name: "x",
        sort_order: 0,
      }),
    ).rejects.toBeInstanceOf(AdminCategorisationSlugDuplicate);
  });
});

describe("deleteCut", () => {
  it("OK si products=0 → ok:true", async () => {
    bus.push("products", "select-count", { count: 0, error: null });
    bus.push("cuts", "delete", { data: null, error: null });
    const res = await deleteCut(bus.buildClient(), ID);
    expect(res.ok).toBe(true);
    expect(bus.captured.fromCalls).toEqual(["products", "cuts"]);
    expect(bus.captured.deletes).toHaveLength(1);
  });

  it("BLOQUÉ si products > 0 → throw, pas de DELETE", async () => {
    bus.push("products", "select-count", { count: 2, error: null });
    let thrown: unknown = null;
    try {
      await deleteCut(bus.buildClient(), ID);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AdminCategorisationDeleteBlocked);
    if (thrown instanceof AdminCategorisationDeleteBlocked) {
      expect(thrown.resource).toBe("cut");
      expect(thrown.dependencies.products).toBe(2);
    }
    expect(bus.captured.deletes).toEqual([]);
  });
});

describe("AdminCategorisationDeleteBlocked message", () => {
  it("formate les counts pour debug stack trace", () => {
    const e = new AdminCategorisationDeleteBlocked("animal", {
      products: 3,
      cuts: 5,
    });
    expect(e.message).toContain("3 produit(s)");
    expect(e.message).toContain("5 morceau(x)");
    expect(e.message).toContain("animal");
  });
});

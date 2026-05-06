import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  listAnimals,
  getAnimal,
  countAnimalDependencies,
  createAnimal,
  updateAnimal,
  deleteAnimal,
} from "@/lib/products/admin/animals";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
} from "@/lib/products/admin/errors";
import { MockBus, silenceConsole } from "./_supabase-mock";

const ID = "animal-uuid-1";

let bus: MockBus;
let consoles: ReturnType<typeof silenceConsole>;

beforeEach(() => {
  bus = new MockBus();
  consoles = silenceConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listAnimals", () => {
  it("retourne les rows ordonnées", async () => {
    bus.push("animals", "select", {
      data: [
        { id: "1", slug: "boeuf", name: "Bœuf", sort_order: 10 },
        { id: "2", slug: "porc", name: "Porc", sort_order: 30 },
      ],
      error: null,
    });
    const rows = await listAnimals(bus.buildClient());
    expect(rows).toHaveLength(2);
    expect(rows[0].slug).toBe("boeuf");
  });
});

describe("getAnimal", () => {
  it("retourne null si non trouvé", async () => {
    bus.push("animals", "select", { data: null, error: null });
    const row = await getAnimal(bus.buildClient(), ID);
    expect(row).toBeNull();
  });
});

describe("countAnimalDependencies", () => {
  it("compte products + cuts en parallèle", async () => {
    bus.push("products", "select-count", { count: 4, error: null });
    bus.push("cuts", "select-count", { count: 12, error: null });
    const deps = await countAnimalDependencies(bus.buildClient(), ID);
    expect(deps.products).toBe(4);
    expect(deps.cuts).toBe(12);
    expect(bus.captured.eqs).toContainEqual({
      table: "products",
      col: "animal_id",
      val: ID,
    });
    expect(bus.captured.eqs).toContainEqual({
      table: "cuts",
      col: "animal_id",
      val: ID,
    });
  });

  it("count=null sur les 2 → {0,0}", async () => {
    bus.push("products", "select-count", { count: null, error: null });
    bus.push("cuts", "select-count", { count: null, error: null });
    const deps = await countAnimalDependencies(bus.buildClient(), ID);
    expect(deps).toEqual({ products: 0, cuts: 0 });
  });

  it("error sur products → throw", async () => {
    bus.push("products", "select-count", {
      count: null,
      error: { message: "perm denied" },
    });
    bus.push("cuts", "select-count", { count: 0, error: null });
    await expect(
      countAnimalDependencies(bus.buildClient(), ID),
    ).rejects.toThrow("perm denied");
  });

  it("error sur cuts → throw", async () => {
    bus.push("products", "select-count", { count: 0, error: null });
    bus.push("cuts", "select-count", {
      count: null,
      error: { message: "cuts down" },
    });
    await expect(
      countAnimalDependencies(bus.buildClient(), ID),
    ).rejects.toThrow("cuts down");
  });
});

describe("createAnimal", () => {
  it("succès → ok:true + id", async () => {
    bus.push("animals", "insert", {
      data: { id: ID },
      error: null,
    });
    const res = await createAnimal(bus.buildClient(), {
      slug: "dinde",
      name: "Dinde",
      sort_order: 70,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(ID);
    const payload = bus.captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.slug).toBe("dinde");
  });

  it("slug duplicate → throw", async () => {
    bus.push("animals", "insert", {
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    await expect(
      createAnimal(bus.buildClient(), {
        slug: "boeuf",
        name: "Bœuf 2",
        sort_order: 0,
      }),
    ).rejects.toBeInstanceOf(AdminCategorisationSlugDuplicate);
  });
});

describe("updateAnimal", () => {
  it("succès → ok:true", async () => {
    bus.push("animals", "update", { data: null, error: null });
    const res = await updateAnimal(bus.buildClient(), ID, {
      slug: "boeuf",
      name: "Bœuf",
      sort_order: 5,
    });
    expect(res.ok).toBe(true);
    expect(bus.captured.eqs).toContainEqual({
      table: "animals",
      col: "id",
      val: ID,
    });
  });

  it("slug duplicate → throw", async () => {
    bus.push("animals", "update", {
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    await expect(
      updateAnimal(bus.buildClient(), ID, {
        slug: "porc",
        name: "x",
        sort_order: 0,
      }),
    ).rejects.toBeInstanceOf(AdminCategorisationSlugDuplicate);
  });
});

describe("deleteAnimal", () => {
  it("OK si products=0 ET cuts=0 → ok:true", async () => {
    bus.push("products", "select-count", { count: 0, error: null });
    bus.push("cuts", "select-count", { count: 0, error: null });
    bus.push("animals", "delete", { data: null, error: null });
    const res = await deleteAnimal(bus.buildClient(), ID);
    expect(res.ok).toBe(true);
    expect(bus.captured.deletes).toHaveLength(1);
  });

  it("BLOQUÉ si products > 0 (cuts=0) → throw avec products seul", async () => {
    bus.push("products", "select-count", { count: 3, error: null });
    bus.push("cuts", "select-count", { count: 0, error: null });
    let thrown: unknown = null;
    try {
      await deleteAnimal(bus.buildClient(), ID);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AdminCategorisationDeleteBlocked);
    if (thrown instanceof AdminCategorisationDeleteBlocked) {
      expect(thrown.resource).toBe("animal");
      expect(thrown.dependencies.products).toBe(3);
      expect(thrown.dependencies.cuts).toBe(0);
    }
    expect(bus.captured.deletes).toEqual([]);
  });

  it("BLOQUÉ si cuts > 0 (products=0) → throw avec cuts seul", async () => {
    bus.push("products", "select-count", { count: 0, error: null });
    bus.push("cuts", "select-count", { count: 30, error: null });
    let thrown: unknown = null;
    try {
      await deleteAnimal(bus.buildClient(), ID);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AdminCategorisationDeleteBlocked);
    if (thrown instanceof AdminCategorisationDeleteBlocked) {
      expect(thrown.dependencies.cuts).toBe(30);
      expect(thrown.dependencies.products).toBe(0);
    }
  });

  it("BLOQUÉ si les 2 > 0 → throw avec products ET cuts", async () => {
    bus.push("products", "select-count", { count: 2, error: null });
    bus.push("cuts", "select-count", { count: 5, error: null });
    let thrown: unknown = null;
    try {
      await deleteAnimal(bus.buildClient(), ID);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AdminCategorisationDeleteBlocked);
    if (thrown instanceof AdminCategorisationDeleteBlocked) {
      expect(thrown.dependencies.products).toBe(2);
      expect(thrown.dependencies.cuts).toBe(5);
    }
  });
});

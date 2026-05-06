import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  listCategories,
  getCategory,
  countCategoryDependencies,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/products/admin/categories";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
} from "@/lib/products/admin/errors";
import { MockBus, silenceConsole } from "./_supabase-mock";

const ID = "cat-uuid-1";

let bus: MockBus;
let consoles: ReturnType<typeof silenceConsole>;

beforeEach(() => {
  bus = new MockBus();
  consoles = silenceConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listCategories", () => {
  it("retourne les rows ordonnées par sort_order/name", async () => {
    bus.push("product_categories", "select", {
      data: [
        { id: "1", slug: "viande", name: "Viande", sort_order: 10 },
        { id: "2", slug: "legumes", name: "Légumes", sort_order: 30 },
      ],
      error: null,
    });
    const rows = await listCategories(bus.buildClient());
    expect(rows).toHaveLength(2);
    expect(rows[0].slug).toBe("viande");
  });

  it("DB error → throw", async () => {
    bus.push("product_categories", "select", {
      data: null,
      error: { message: "db down" },
    });
    await expect(listCategories(bus.buildClient())).rejects.toThrow(
      "db down",
    );
    expect(consoles.errorSpy).toHaveBeenCalled();
  });
});

describe("getCategory", () => {
  it("retourne null si non trouvé", async () => {
    bus.push("product_categories", "select", { data: null, error: null });
    const row = await getCategory(bus.buildClient(), ID);
    expect(row).toBeNull();
  });

  it("retourne la row si trouvée", async () => {
    bus.push("product_categories", "select", {
      data: { id: ID, slug: "viande", name: "Viande", sort_order: 10 },
      error: null,
    });
    const row = await getCategory(bus.buildClient(), ID);
    expect(row?.slug).toBe("viande");
  });
});

describe("countCategoryDependencies", () => {
  it("compte les produits liés via category_id", async () => {
    bus.push("products", "select-count", { count: 3, error: null });
    const deps = await countCategoryDependencies(bus.buildClient(), ID);
    expect(deps.products).toBe(3);
    // Vérifie que le filtre eq porte bien sur category_id
    expect(bus.captured.eqs).toContainEqual({
      table: "products",
      col: "category_id",
      val: ID,
    });
  });

  it("count=null → 0", async () => {
    bus.push("products", "select-count", { count: null, error: null });
    const deps = await countCategoryDependencies(bus.buildClient(), ID);
    expect(deps.products).toBe(0);
  });

  it("DB error → throw", async () => {
    bus.push("products", "select-count", {
      count: null,
      error: { message: "perm denied" },
    });
    await expect(
      countCategoryDependencies(bus.buildClient(), ID),
    ).rejects.toThrow("perm denied");
  });
});

describe("createCategory", () => {
  it("succès → ok:true + id retourné, payload contient slug/name/sort_order", async () => {
    bus.push("product_categories", "insert", {
      data: { id: ID },
      error: null,
    });
    const res = await createCategory(bus.buildClient(), {
      slug: "fruits",
      name: "Fruits",
      sort_order: 25,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.id).toBe(ID);
    expect(bus.captured.inserts).toHaveLength(1);
    const payload = bus.captured.inserts[0].payload as Record<string, unknown>;
    expect(payload.slug).toBe("fruits");
    expect(payload.name).toBe("Fruits");
    expect(payload.sort_order).toBe(25);
  });

  it("slug duplicate (SQLSTATE 23505) → throw AdminCategorisationSlugDuplicate", async () => {
    bus.push("product_categories", "insert", {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "product_categories_slug_key"',
      },
    });
    await expect(
      createCategory(bus.buildClient(), {
        slug: "viande",
        name: "Viande dup",
        sort_order: 10,
      }),
    ).rejects.toMatchObject({
      name: "AdminCategorisationSlugDuplicate",
      slug: "viande",
      resource: "category",
    });
  });

  it("autre DB error → ok:false + log", async () => {
    bus.push("product_categories", "insert", {
      data: null,
      error: { code: "23502", message: "null value in not-null" },
    });
    const res = await createCategory(bus.buildClient(), {
      slug: "x",
      name: "X",
      sort_order: 0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("null value");
    expect(consoles.errorSpy).toHaveBeenCalled();
  });
});

describe("updateCategory", () => {
  it("succès → ok:true, eq sur id correct", async () => {
    bus.push("product_categories", "update", { data: null, error: null });
    const res = await updateCategory(bus.buildClient(), ID, {
      slug: "viandes",
      name: "Viandes",
      sort_order: 11,
    });
    expect(res.ok).toBe(true);
    expect(bus.captured.eqs).toContainEqual({
      table: "product_categories",
      col: "id",
      val: ID,
    });
    const payload = bus.captured.updates[0].payload as Record<string, unknown>;
    expect(payload.slug).toBe("viandes");
    expect(payload.sort_order).toBe(11);
  });

  it("slug duplicate → throw AdminCategorisationSlugDuplicate", async () => {
    bus.push("product_categories", "update", {
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    await expect(
      updateCategory(bus.buildClient(), ID, {
        slug: "viande",
        name: "x",
        sort_order: 0,
      }),
    ).rejects.toBeInstanceOf(AdminCategorisationSlugDuplicate);
  });
});

describe("deleteCategory", () => {
  it("OK si pas de produits liés → ok:true", async () => {
    bus.push("products", "select-count", { count: 0, error: null });
    bus.push("product_categories", "delete", { data: null, error: null });
    const res = await deleteCategory(bus.buildClient(), ID);
    expect(res.ok).toBe(true);
    // Ordre opérations : count d'abord, delete ensuite
    expect(bus.captured.fromCalls).toEqual(["products", "product_categories"]);
    expect(bus.captured.deletes).toHaveLength(1);
  });

  it("BLOQUÉ si products > 0 → throw AdminCategorisationDeleteBlocked", async () => {
    bus.push("products", "select-count", { count: 5, error: null });
    let thrown: unknown = null;
    try {
      await deleteCategory(bus.buildClient(), ID);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AdminCategorisationDeleteBlocked);
    if (thrown instanceof AdminCategorisationDeleteBlocked) {
      expect(thrown.resource).toBe("category");
      expect(thrown.dependencies.products).toBe(5);
    }
    // Pas de DELETE tenté
    expect(bus.captured.deletes).toEqual([]);
    expect(bus.captured.fromCalls).toEqual(["products"]);
  });

  it("DELETE error post-count → ok:false", async () => {
    bus.push("products", "select-count", { count: 0, error: null });
    bus.push("product_categories", "delete", {
      data: null,
      error: { message: "fk violation" },
    });
    const res = await deleteCategory(bus.buildClient(), ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("fk violation");
  });
});

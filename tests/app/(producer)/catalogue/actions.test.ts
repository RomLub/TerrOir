import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  resolveProducerOwner: vi.fn(),
  captured: {
    productInsert: null as unknown,
    productUpdate: null as unknown,
    reservedSlotInsert: null as unknown,
    linkInsert: null as unknown,
    linkDeleteProductId: null as unknown,
  },
  insertResult: { data: null as unknown, error: null as unknown },
  existingProduct: { data: null as unknown, error: null as unknown },
  updateResult: { error: null as unknown },
  deleteLinksResult: { error: null as unknown },
  insertLinksResult: { error: null as unknown },
  slotOwnerRows: [] as Array<{ id: string; producer_id: string }>,
  conflictSlotRows: [] as Array<{ id: string }>,
  insertedSlotRows: [] as Array<{ id: string }>,
  linkedRows: [] as Array<{ slot_id: string }>,
  linkedSlotScopeRows: [] as Array<{ id: string; availability_scope: string }>,
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/producers/resolve-owner", () => ({
  resolveProducerOwner: mocks.resolveProducerOwner,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = { table, op: null, selectCols: "" };
      const resolve = () => {
        if (table === "products" && b.op === "update") {
          return mocks.updateResult;
        }
        if (table === "product_slot_availabilities" && b.op === "delete") {
          return mocks.deleteLinksResult;
        }
        if (table === "product_slot_availabilities" && b.op === "insert") {
          return mocks.insertLinksResult;
        }
        if (table === "product_slot_availabilities" && b.op === "select") {
          return { data: mocks.linkedRows, error: null };
        }
        if (table === "slots" && b.op === "select") {
          if (String(b.selectCols).includes("producer_id")) {
            return { data: mocks.slotOwnerRows, error: null };
          }
          if (String(b.selectCols).includes("availability_scope")) {
            return { data: mocks.linkedSlotScopeRows, error: null };
          }
          return { data: mocks.conflictSlotRows, error: null };
        }
        if (table === "slots" && b.op === "insert") {
          return { data: mocks.insertedSlotRows, error: null };
        }
        return { data: null, error: null };
      };
      b.insert = (p: unknown) => {
        b.op = "insert";
        if (table === "products") mocks.captured.productInsert = p;
        if (table === "slots") mocks.captured.reservedSlotInsert = p;
        if (table === "product_slot_availabilities") {
          mocks.captured.linkInsert = p;
        }
        return b;
      };
      b.update = (p: unknown) => {
        b.op = "update";
        mocks.captured.productUpdate = p;
        return b;
      };
      b.delete = () => {
        b.op = "delete";
        return b;
      };
      b.select = (cols: string) => {
        if (b.op === null) b.op = "select";
        b.selectCols = cols;
        return b;
      };
      b.eq = (column: string, value: unknown) => {
        if (table === "product_slot_availabilities" && b.op === "delete") {
          mocks.captured.linkDeleteProductId = value;
        }
        return b;
      };
      b.in = () => b;
      b.single = () => Promise.resolve(mocks.insertResult);
      b.maybeSingle = () => Promise.resolve(mocks.existingProduct);
      b.then = (onF: (r: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF);
      return b;
    },
  }),
}));
vi.mock("@/lib/stats/revalidate", () => ({
  revalidatePublicStats: vi.fn(),
  revalidatePublicProducts: vi.fn(),
  revalidateProducerProducts: vi.fn(),
  revalidateProducersSearch: vi.fn(),
}));

import {
  createProductAction,
  updateProductAction,
} from "@/app/(producer)/catalogue/actions";

const SLOT_1 = "11111111-1111-4111-8111-111111111111";
const SLOT_2 = "22222222-2222-4222-8222-222222222222";
const SLOT_OTHER = "33333333-3333-4333-8333-333333333333";

function validProduct() {
  return {
    nom: "Côte de boeuf",
    description: "desc",
    prix: 25,
    unite: "kg",
    poids_estime_kg: 1.2,
    stock_disponible: 10,
    stock_illimite: false,
    delai_preparation_jours: 2,
    active: true,
    photos: ["https://x/1.jpg"],
    conseil_active: false,
    conseil_texte: null,
    category_id: null,
    animal_id: null,
    cut_id: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.captured.productInsert = null;
  mocks.captured.productUpdate = null;
  mocks.captured.reservedSlotInsert = null;
  mocks.captured.linkInsert = null;
  mocks.captured.linkDeleteProductId = null;
  mocks.insertResult = { data: { id: "new-prod" }, error: null };
  mocks.existingProduct = {
    data: { id: "prod-1", producer_id: "p1" },
    error: null,
  };
  mocks.updateResult = { error: null };
  mocks.deleteLinksResult = { error: null };
  mocks.insertLinksResult = { error: null };
  mocks.slotOwnerRows = [];
  mocks.conflictSlotRows = [];
  mocks.insertedSlotRows = [];
  mocks.linkedRows = [];
  mocks.linkedSlotScopeRows = [];
  mocks.getSessionUser.mockResolvedValue({ id: "u1", isAdmin: false, roles: [] });
  mocks.resolveProducerOwner.mockResolvedValue({
    owner: { id: "p1", slug: "ferme", statut: "public" },
  });
});

describe("createProductAction", () => {
  it("erreur si pas de session, sans insert", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    const res = await createProductAction(validProduct());
    expect(res.error).toBeTruthy();
    expect(mocks.captured.productInsert).toBeNull();
  });

  it("happy path : producer_id vient de l'ownership serveur", async () => {
    const res = await createProductAction(validProduct());
    expect(res.success).toBe(true);
    expect(res.productId).toBe("new-prod");
    const payload = mocks.captured.productInsert as Record<string, unknown>;
    expect(payload.producer_id).toBe("p1");
    expect(payload.pickup_availability_mode).toBe("all_shared_slots");
    expect(payload.nom).toBe("Côte de boeuf");
  });

  it("SÉCURITÉ : producer_id fourni par le client est ignoré", async () => {
    const res = await createProductAction({
      ...validProduct(),
      producer_id: "autre-producteur",
    } as never);
    expect(res.success).toBe(true);
    const payload = mocks.captured.productInsert as Record<string, unknown>;
    expect(payload.producer_id).toBe("p1");
  });

  it("prix négatif → erreur de validation, pas d'insert", async () => {
    const res = await createProductAction({ ...validProduct(), prix: -5 });
    expect(res.error).toBeTruthy();
    expect(mocks.captured.productInsert).toBeNull();
  });

  it("erreur SQL insert → message d'erreur", async () => {
    mocks.insertResult = { data: null, error: { message: "boom" } };
    const res = await createProductAction(validProduct());
    expect(res.error).toBeTruthy();
  });
  it("mode certains creneaux : cree les liens explicites", async () => {
    mocks.slotOwnerRows = [{ id: SLOT_1, producer_id: "p1" }];

    const res = await createProductAction({
      ...validProduct(),
      pickup_availability_mode: "selected_slots",
      slot_ids: [SLOT_1],
    });

    expect(res.success).toBe(true);
    const payload = mocks.captured.productInsert as Record<string, unknown>;
    expect(payload.pickup_availability_mode).toBe("selected_slots");
    expect(mocks.captured.linkInsert).toEqual([
      { product_id: "new-prod", slot_id: SLOT_1 },
    ]);
  });

  it("mode certains creneaux sans selection : refuse avant insert", async () => {
    const res = await createProductAction({
      ...validProduct(),
      pickup_availability_mode: "selected_slots",
      slot_ids: [],
    });

    expect(res.error).toMatch(/au moins un creneau/i);
    expect(mocks.captured.productInsert).toBeNull();
  });

  it("creneau reserve : cree un slot product_restricted puis le lie au produit", async () => {
    mocks.insertedSlotRows = [{ id: "slot-reserved" }];

    const res = await createProductAction({
      ...validProduct(),
      reserved_slots: [
        {
          start_at: "2099-06-15T09:00",
          end_at: "2099-06-15T10:00",
          capacity_per_slot: 2,
        },
      ],
    });

    expect(res.success).toBe(true);
    expect(mocks.captured.reservedSlotInsert).toEqual([
      expect.objectContaining({
        producer_id: "p1",
        rule_id: null,
        capacity_per_slot: 2,
        active: true,
        availability_scope: "product_restricted",
      }),
    ]);
    expect(mocks.captured.linkInsert).toEqual([
      { product_id: "new-prod", slot_id: "slot-reserved" },
    ]);
  });

  it("SECURITE : refuse un creneau d'un autre producteur", async () => {
    mocks.slotOwnerRows = [{ id: SLOT_OTHER, producer_id: "p2" }];

    const res = await createProductAction({
      ...validProduct(),
      pickup_availability_mode: "selected_slots",
      slot_ids: [SLOT_OTHER],
    });

    expect(res.error).toMatch(/introuvable/i);
    expect(mocks.captured.productInsert).toBeNull();
  });
});

describe("updateProductAction", () => {
  it("produit d'un autre producteur → erreur, pas d'update", async () => {
    mocks.existingProduct = {
      data: { id: "prod-1", producer_id: "autre" },
      error: null,
    };
    const res = await updateProductAction("prod-1", validProduct());
    expect(res.error).toBeTruthy();
    expect(mocks.captured.productUpdate).toBeNull();
  });

  it("produit introuvable → erreur, pas d'update", async () => {
    mocks.existingProduct = { data: null, error: null };
    const res = await updateProductAction("prod-1", validProduct());
    expect(res.error).toBeTruthy();
    expect(mocks.captured.productUpdate).toBeNull();
  });

  it("happy path : update OK + stock forcé à 0 si illimité", async () => {
    const res = await updateProductAction("prod-1", {
      ...validProduct(),
      stock_illimite: true,
      stock_disponible: 99,
    });
    expect(res.success).toBe(true);
    const payload = mocks.captured.productUpdate as Record<string, unknown>;
    expect(payload.stock_illimite).toBe(true);
    expect(payload.stock_disponible).toBe(0);
  });

  it("edition produit existant : remplace les liens de creneaux", async () => {
    mocks.slotOwnerRows = [{ id: SLOT_2, producer_id: "p1" }];

    const res = await updateProductAction("prod-1", {
      ...validProduct(),
      pickup_availability_mode: "selected_slots",
      slot_ids: [SLOT_2],
    });

    expect(res.success).toBe(true);
    const payload = mocks.captured.productUpdate as Record<string, unknown>;
    expect(payload.pickup_availability_mode).toBe("selected_slots");
    expect(mocks.captured.linkDeleteProductId).toBe("prod-1");
    expect(mocks.captured.linkInsert).toEqual([
      { product_id: "prod-1", slot_id: SLOT_2 },
    ]);
  });

  it("erreur SQL update", async () => {
    mocks.updateResult = { error: { message: "boom" } };
    const res = await updateProductAction("prod-1", validProduct());
    expect(res.error).toBeTruthy();
  });
});

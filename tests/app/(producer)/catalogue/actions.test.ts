import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  resolveProducerOwner: vi.fn(),
  captured: { insert: null as unknown, update: null as unknown },
  insertResult: { data: null as unknown, error: null as unknown },
  existingProduct: { data: null as unknown, error: null as unknown },
  updateResult: { error: null as unknown },
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/producers/resolve-owner", () => ({
  resolveProducerOwner: mocks.resolveProducerOwner,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.insert = (p: unknown) => {
        mocks.captured.insert = p;
        return b;
      };
      b.update = (p: unknown) => {
        mocks.captured.update = p;
        return b;
      };
      b.select = () => b;
      b.eq = () => b;
      b.single = () => Promise.resolve(mocks.insertResult);
      b.maybeSingle = () => Promise.resolve(mocks.existingProduct);
      b.then = (onF: (r: unknown) => unknown) => onF(mocks.updateResult);
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
  mocks.captured.insert = null;
  mocks.captured.update = null;
  mocks.insertResult = { data: { id: "new-prod" }, error: null };
  mocks.existingProduct = {
    data: { id: "prod-1", producer_id: "p1" },
    error: null,
  };
  mocks.updateResult = { error: null };
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
    expect(mocks.captured.insert).toBeNull();
  });

  it("happy path : producer_id vient de l'ownership serveur", async () => {
    const res = await createProductAction(validProduct());
    expect(res.success).toBe(true);
    expect(res.productId).toBe("new-prod");
    const payload = mocks.captured.insert as Record<string, unknown>;
    expect(payload.producer_id).toBe("p1");
    expect(payload.nom).toBe("Côte de boeuf");
  });

  it("SÉCURITÉ : producer_id fourni par le client est ignoré", async () => {
    const res = await createProductAction({
      ...validProduct(),
      producer_id: "autre-producteur",
    } as never);
    expect(res.success).toBe(true);
    const payload = mocks.captured.insert as Record<string, unknown>;
    expect(payload.producer_id).toBe("p1");
  });

  it("prix négatif → erreur de validation, pas d'insert", async () => {
    const res = await createProductAction({ ...validProduct(), prix: -5 });
    expect(res.error).toBeTruthy();
    expect(mocks.captured.insert).toBeNull();
  });

  it("erreur SQL insert → message d'erreur", async () => {
    mocks.insertResult = { data: null, error: { message: "boom" } };
    const res = await createProductAction(validProduct());
    expect(res.error).toBeTruthy();
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
    expect(mocks.captured.update).toBeNull();
  });

  it("produit introuvable → erreur, pas d'update", async () => {
    mocks.existingProduct = { data: null, error: null };
    const res = await updateProductAction("prod-1", validProduct());
    expect(res.error).toBeTruthy();
    expect(mocks.captured.update).toBeNull();
  });

  it("happy path : update OK + stock forcé à 0 si illimité", async () => {
    const res = await updateProductAction("prod-1", {
      ...validProduct(),
      stock_illimite: true,
      stock_disponible: 99,
    });
    expect(res.success).toBe(true);
    const payload = mocks.captured.update as Record<string, unknown>;
    expect(payload.stock_illimite).toBe(true);
    expect(payload.stock_disponible).toBe(0);
  });

  it("erreur SQL update → message d'erreur", async () => {
    mocks.updateResult = { error: { message: "boom" } };
    const res = await updateProductAction("prod-1", validProduct());
    expect(res.error).toBeTruthy();
  });
});

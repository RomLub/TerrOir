import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  resolveProducerOwner: vi.fn(),
  updateResult: { error: null as unknown },
  capturedUpdate: { payload: null as unknown },
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/producers/resolve-owner", () => ({
  resolveProducerOwner: mocks.resolveProducerOwner,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      update: (payload: unknown) => {
        mocks.capturedUpdate.payload = payload;
        return { eq: () => Promise.resolve(mocks.updateResult) };
      },
    }),
  }),
}));
vi.mock("@/lib/stats/revalidate", () => ({
  revalidateProducerCard: vi.fn(),
  revalidateProducersSearch: vi.fn(),
}));

import { updateProfileAction } from "@/app/(producer)/ma-page/actions";

function validInput() {
  return {
    nom_exploitation: "Ferme du Test",
    description: "desc",
    histoire: null,
    generations: 3,
    annee_creation: 1990,
    especes: ["bovin"],
    labels: [],
    commune: "Le Mans",
    code_postal: "72000",
    photo_principale: "https://x/hero.jpg",
    photos: ["https://x/1.jpg"],
    bio: true,
    bio_certificate_number: "FR-BIO-01",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateResult = { error: null };
  mocks.capturedUpdate.payload = null;
  mocks.getSessionUser.mockResolvedValue({ id: "u1", isAdmin: false, roles: [] });
  mocks.resolveProducerOwner.mockResolvedValue({
    owner: { id: "p1", slug: "ferme", statut: "public" },
  });
});

describe("updateProfileAction", () => {
  it("erreur si pas de session, sans aucun UPDATE", async () => {
    mocks.getSessionUser.mockResolvedValueOnce(null);
    const res = await updateProfileAction(validInput());
    expect(res.error).toBeTruthy();
    expect(mocks.capturedUpdate.payload).toBeNull();
  });

  it("erreur si producteur introuvable, sans UPDATE", async () => {
    mocks.resolveProducerOwner.mockResolvedValueOnce({
      error: "Profil producteur introuvable.",
    });
    const res = await updateProfileAction(validInput());
    expect(res.error).toBeTruthy();
    expect(mocks.capturedUpdate.payload).toBeNull();
  });

  it("happy path : update OK, colonnes producer-writable seulement", async () => {
    const res = await updateProfileAction(validInput());
    expect(res.success).toBe(true);
    const payload = mocks.capturedUpdate.payload as Record<string, unknown>;
    expect(payload.nom_exploitation).toBe("Ferme du Test");
    expect(payload.especes).toEqual(["bovin"]);
    expect(payload.labels).toBeNull(); // tableau vide → null
  });

  it("SÉCURITÉ : les colonnes admin-only envoyées par le client sont ignorées", async () => {
    const malicious = {
      ...validInput(),
      statut: "public",
      slug: "pirate",
      badge_stock_score: 100,
      bio_validated_at: "2026-01-01",
      latitude: 1.23,
      user_id: "autre",
      publication_requested_at: "2026-01-01",
    };
    const res = await updateProfileAction(malicious as never);
    expect(res.success).toBe(true);
    const payload = mocks.capturedUpdate.payload as Record<string, unknown>;
    for (const k of [
      "statut",
      "slug",
      "badge_stock_score",
      "bio_validated_at",
      "latitude",
      "user_id",
      "publication_requested_at",
    ]) {
      expect(payload).not.toHaveProperty(k);
    }
  });

  it("bio décochée → bio_certificate_number forcé à null", async () => {
    const res = await updateProfileAction({
      ...validInput(),
      bio: false,
      bio_certificate_number: "FR-BIO-01",
    });
    expect(res.success).toBe(true);
    const payload = mocks.capturedUpdate.payload as Record<string, unknown>;
    expect(payload.bio).toBe(false);
    expect(payload.bio_certificate_number).toBeNull();
  });

  it("nom vide → erreur de validation, pas d'UPDATE", async () => {
    const res = await updateProfileAction({
      ...validInput(),
      nom_exploitation: "",
    });
    expect(res.error).toBeTruthy();
    expect(mocks.capturedUpdate.payload).toBeNull();
  });

  it("erreur SQL sur update → message d'erreur", async () => {
    mocks.updateResult = { error: { message: "boom" } };
    const res = await updateProfileAction(validInput());
    expect(res.error).toBeTruthy();
  });
});

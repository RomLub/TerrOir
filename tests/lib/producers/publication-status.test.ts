import { describe, it, expect, beforeEach, vi } from "vitest";

const holder: { result: { data: unknown; error: unknown } } = {
  result: { data: null, error: null },
};

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: () => Promise.resolve(holder.result),
  }),
}));

import { getPublicationStatus } from "@/lib/producers/publication-status";

beforeEach(() => {
  holder.result = { data: null, error: null };
});

describe("getPublicationStatus", () => {
  it("mappe le retour RPC en objet typé", async () => {
    holder.result = {
      data: {
        found: true,
        statut: "pending",
        already_public: false,
        publication_requested: false,
        criteria: {
          description: true,
          photo_principale: false,
          localisation: true,
          stripe: false,
          product_with_photo: false,
          open_slot: true,
        },
        missing: ["photo_principale", "stripe", "product_with_photo"],
        all_ok: false,
      },
      error: null,
    };
    const s = await getPublicationStatus("u1");
    expect(s.found).toBe(true);
    expect(s.statut).toBe("pending");
    expect(s.allOk).toBe(false);
    expect(s.criteria.description).toBe(true);
    expect(s.criteria.stripe).toBe(false);
    expect(s.missing).toContain("stripe");
  });

  it("found false si la RPC ne trouve pas le producteur", async () => {
    holder.result = { data: { found: false }, error: null };
    const s = await getPublicationStatus("u1");
    expect(s.found).toBe(false);
    expect(s.allOk).toBe(false);
  });

  it("found false + critères vides si erreur RPC (fail-safe)", async () => {
    holder.result = { data: null, error: { message: "boom" } };
    const s = await getPublicationStatus("u1");
    expect(s.found).toBe(false);
    expect(s.criteria.description).toBe(false);
  });

  it("all_ok true → allOk true", async () => {
    holder.result = {
      data: {
        found: true,
        statut: "pending",
        already_public: false,
        publication_requested: false,
        criteria: {
          description: true,
          photo_principale: true,
          localisation: true,
          stripe: true,
          product_with_photo: true,
          open_slot: true,
        },
        missing: [],
        all_ok: true,
      },
      error: null,
    };
    const s = await getPublicationStatus("u1");
    expect(s.allOk).toBe(true);
  });
});

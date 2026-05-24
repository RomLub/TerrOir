import { describe, it, expect, beforeEach, vi } from "vitest";

const holder: { result: { data: unknown; error: unknown } } = {
  result: { data: null, error: null },
};

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    const builder: Record<string, unknown> = {
      from: () => builder,
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => Promise.resolve(holder.result),
    };
    return builder;
  },
}));

import { resolveProducerOwner } from "@/lib/producers/resolve-owner";

beforeEach(() => {
  holder.result = { data: null, error: null };
});

describe("resolveProducerOwner", () => {
  it("renvoie owner {id, slug, statut} si trouvé", async () => {
    holder.result = {
      data: { id: "p1", slug: "ferme", statut: "public" },
      error: null,
    };
    const res = await resolveProducerOwner("u1");
    expect(res).toEqual({
      owner: { id: "p1", slug: "ferme", statut: "public" },
    });
  });

  it("error si aucun producteur", async () => {
    holder.result = { data: null, error: null };
    const res = await resolveProducerOwner("u1");
    expect("error" in res).toBe(true);
  });

  it("error si erreur DB", async () => {
    holder.result = { data: null, error: { message: "down" } };
    const res = await resolveProducerOwner("u1");
    expect("error" in res).toBe(true);
  });

  it("slug/statut nuls → chaînes vides", async () => {
    holder.result = {
      data: { id: "p1", slug: null, statut: null },
      error: null,
    };
    const res = await resolveProducerOwner("u1");
    expect(res).toEqual({ owner: { id: "p1", slug: "", statut: "" } });
  });
});

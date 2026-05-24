import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveInboundTag } from "@/lib/admin/inbound/tag";

// Tests resolveInboundTag (chantier 9) : tag automatique de l'expéditeur.

function makeAdmin(opts: { user?: unknown; lead?: unknown }): SupabaseClient {
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.ilike = () => b;
      b.maybeSingle = () =>
        Promise.resolve({
          data: table === "users" ? (opts.user ?? null) : (opts.lead ?? null),
          error: null,
        });
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("resolveInboundTag", () => {
  it("user avec rôle producer → producteur + lookupUserId", async () => {
    const r = await resolveInboundTag(
      makeAdmin({ user: { id: "u1", roles: ["consumer", "producer"] } }),
      "P@x.fr",
    );
    expect(r).toEqual({ tag: "producteur", lookupUserId: "u1", lookupLeadId: null });
  });

  it("user sans rôle producer → consommateur", async () => {
    const r = await resolveInboundTag(
      makeAdmin({ user: { id: "u2", roles: ["consumer"] } }),
      "c@x.fr",
    );
    expect(r).toEqual({ tag: "consommateur", lookupUserId: "u2", lookupLeadId: null });
  });

  it("pas de user mais lead (producer_interests) → producteur + lookupLeadId", async () => {
    const r = await resolveInboundTag(makeAdmin({ user: null, lead: { id: "l1" } }), "lead@x.fr");
    expect(r).toEqual({ tag: "producteur", lookupUserId: null, lookupLeadId: "l1" });
  });

  it("inconnu → public", async () => {
    const r = await resolveInboundTag(makeAdmin({ user: null, lead: null }), "ghost@x.fr");
    expect(r).toEqual({ tag: "public", lookupUserId: null, lookupLeadId: null });
  });
});

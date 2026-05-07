// Test scaffold T-296 cible #2 — RPC `update_producer_indicateurs` (T-232,
// 7 args, sémantique miroir post-onboarding).
//
// Cible : la décision SQL de re-persistance des declaration_indicateurs_*
// (T-241 + T-243) ré-appliquée dans cette RPC dédiée à la rectification
// post-onboarding. Symétrique à update-producer-onboarding.test.ts mais
// vérifie en plus que statut/slug/badges sont préservés (pas de régression
// vers 'pending' à la rectification).
//
// Pré-requis : `npx supabase start`. Sans instance locale, la suite est
// skippée proprement (cf. helpers/client.ts).

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getSqlIntegrationClient,
  isLocalSupabaseReachable,
} from "./helpers/client";
import {
  seedProducer,
  cleanupProducer,
  type SeededProducer,
} from "./helpers/seed";

const SUPABASE = getSqlIntegrationClient();

function buildArgs(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    p_user_id: overrides.p_user_id ?? "",
    p_mode_elevage: overrides.p_mode_elevage ?? "plein_air",
    p_alimentation: overrides.p_alimentation ?? "herbe_majoritaire",
    p_densite_animale: overrides.p_densite_animale ?? "extensif",
    p_declaration_cochee: overrides.p_declaration_cochee ?? true,
    p_wording_version: overrides.p_wording_version ?? "v1.1",
    p_enums_version: overrides.p_enums_version ?? "v1.0",
  };
}

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

describeIfLocal(
  "update_producer_indicateurs (T-232, 7 args) — rectification post-onboarding",
  () => {
    let seeded: SeededProducer;

    beforeAll(() => {
      if (!reachable) {
        // eslint-disable-next-line no-console
        console.warn(
          "[T-296] Supabase locale non joignable, tests SQL skippés. " +
            "Lance `npx supabase start` pour exécuter la suite.",
        );
      }
    });

    afterEach(async () => {
      if (seeded) await cleanupProducer(SUPABASE, seeded);
    });

    it("snapshot null + déclaration cochée + 3 enums valeurs ⇒ persiste indicateurs (statut PRESERVÉ)", async () => {
      seeded = await seedProducer(SUPABASE, {
        statut: "active",
        declaration_indicateurs_snapshot: null,
      });

      const { error } = await SUPABASE.rpc(
        "update_producer_indicateurs",
        buildArgs({ p_user_id: seeded.userId }),
      );
      expect(error).toBeNull();

      const { data } = await SUPABASE
        .from("producers")
        .select(
          "statut, mode_elevage, alimentation, densite_animale, declaration_indicateurs_veracite_at, declaration_indicateurs_wording_version",
        )
        .eq("id", seeded.producerId)
        .single();

      // T-232 garantie clé : pas de régression statut → pending. Le producer
      // reste 'active' (ou 'public') après rectification d'indicateurs.
      expect(data?.statut).toBe("active");
      expect(data?.mode_elevage).toBe("plein_air");
      expect(data?.declaration_indicateurs_veracite_at).not.toBeNull();
      expect(data?.declaration_indicateurs_wording_version).toBe("v1.1");
    });

    it("snapshot identique + déclaration cochée ⇒ NE re-persiste PAS (timestamp préservé)", async () => {
      const previousTs = "2025-01-01T00:00:00Z";
      seeded = await seedProducer(SUPABASE, {
        statut: "active",
        declaration_indicateurs_snapshot: {
          mode_elevage: "plein_air",
          alimentation: "herbe_majoritaire",
          densite_animale: "extensif",
        },
      });

      await SUPABASE
        .from("producers")
        .update({ declaration_indicateurs_veracite_at: previousTs })
        .eq("id", seeded.producerId);

      const { error } = await SUPABASE.rpc(
        "update_producer_indicateurs",
        buildArgs({ p_user_id: seeded.userId }),
      );
      expect(error).toBeNull();

      const { data } = await SUPABASE
        .from("producers")
        .select("declaration_indicateurs_veracite_at")
        .eq("id", seeded.producerId)
        .single();

      expect(new Date(data!.declaration_indicateurs_veracite_at!).toISOString())
        .toBe(new Date(previousTs).toISOString());
    });

    it("user inexistant ⇒ raise P0002 'Producer non trouvé'", async () => {
      const fakeUserId = "00000000-0000-0000-0000-000000000000";
      const { error } = await SUPABASE.rpc(
        "update_producer_indicateurs",
        buildArgs({ p_user_id: fakeUserId }),
      );

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Producer non trouvé/);
    });
  },
);

// Test pilote T-296 — RPC `update_producer_onboarding` (15 args, signature
// courante post-T-300).
//
// Cible : la décision SQL de re-persistance des declaration_indicateurs_*
// (T-241), qui est exactement le type de logique métier qu'un test Vitest
// avec mocks ne peut pas valider — elle vit dans le CASE WHEN de la RPC.
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

// Args canoniques — défaut OK, surchargés par test.
function buildArgs(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    p_user_id: overrides.p_user_id ?? "",
    p_nom_exploitation: overrides.p_nom_exploitation ?? "Ferme test T-296",
    p_forme_juridique: overrides.p_forme_juridique ?? "ei",
    p_siret: overrides.p_siret ?? "12345678900012",
    p_adresse: overrides.p_adresse ?? "1 rue du Test",
    p_code_postal: overrides.p_code_postal ?? "72000",
    p_commune: overrides.p_commune ?? "Le Mans",
    p_type_production: overrides.p_type_production ?? "elevage",
    p_type_production_precision: overrides.p_type_production_precision ?? null,
    p_mode_elevage: overrides.p_mode_elevage ?? "plein_air",
    p_alimentation: overrides.p_alimentation ?? "pature_dominante",
    p_densite_animale: overrides.p_densite_animale ?? "extensive",
    p_declaration_cochee: overrides.p_declaration_cochee ?? true,
    p_wording_version: overrides.p_wording_version ?? "v1.1",
    p_enums_version: overrides.p_enums_version ?? "v1.0",
  };
}

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

describeIfLocal(
  "update_producer_onboarding (15 args, T-241+T-243+T-300) — décision SQL re-persistance DGCCRF",
  () => {
    let seeded: SeededProducer;

    beforeAll(() => {
      if (!reachable) {
        console.warn(
          "[T-296] Supabase locale non joignable, tests SQL skippés. " +
            "Lance `npx supabase start` pour exécuter la suite.",
        );
      }
    });

    afterEach(async () => {
      if (seeded) await cleanupProducer(SUPABASE, seeded);
    });

    it("snapshot null + déclaration cochée + 3 enums valeurs ⇒ persiste indicateurs (statut→pending)", async () => {
      seeded = await seedProducer(SUPABASE, {
        statut: "draft",
        declaration_indicateurs_snapshot: null,
      });

      const { error } = await SUPABASE.rpc(
        "update_producer_onboarding",
        buildArgs({ p_user_id: seeded.userId }),
      );
      expect(error).toBeNull();

      // T9 2026-05-07 (debt-P2-8) : SELECT single-line pour permettre
      // l'inférence Supabase TS du type retourné. Avant : concat `+` cassait
      // le pattern matching du parser (data typé GenericStringError → 5 erreurs
      // TS2339).
      const { data, error: selErr } = await SUPABASE
        .from("producers")
        .select(
          "statut, mode_elevage, alimentation, densite_animale, declaration_indicateurs_snapshot, declaration_indicateurs_veracite_at, declaration_indicateurs_wording_version",
        )
        .eq("id", seeded.producerId)
        .single();

      expect(selErr).toBeNull();
      expect(data?.statut).toBe("pending");
      expect(data?.mode_elevage).toBe("plein_air");
      expect(data?.declaration_indicateurs_veracite_at).not.toBeNull();
      expect(data?.declaration_indicateurs_wording_version).toBe("v1.1");
      expect(data?.declaration_indicateurs_snapshot).toMatchObject({
        mode_elevage: "plein_air",
        alimentation: "pature_dominante",
        densite_animale: "extensive",
      });
    });

    it("snapshot identique + déclaration cochée ⇒ NE re-persiste PAS (timestamp préservé)", async () => {
      const previousTs = "2025-01-01T00:00:00Z";
      seeded = await seedProducer(SUPABASE, {
        statut: "active",
        declaration_indicateurs_snapshot: {
          mode_elevage: "plein_air",
          alimentation: "pature_dominante",
          densite_animale: "extensive",
        },
      });

      // Pose un timestamp historique manuel pour vérifier qu'il est préservé.
      await SUPABASE
        .from("producers")
        .update({ declaration_indicateurs_veracite_at: previousTs })
        .eq("id", seeded.producerId);

      const { error } = await SUPABASE.rpc(
        "update_producer_onboarding",
        buildArgs({
          p_user_id: seeded.userId,
          // Args identiques au snapshot existant
          p_mode_elevage: "plein_air",
          p_alimentation: "pature_dominante",
          p_densite_animale: "extensive",
        }),
      );
      expect(error).toBeNull();

      const { data } = await SUPABASE
        .from("producers")
        .select("declaration_indicateurs_veracite_at")
        .eq("id", seeded.producerId)
        .single();

      // Timestamp historique conservé : la décision SQL a vu snapshot==entrée
      // et n'a pas re-daté.
      expect(new Date(data!.declaration_indicateurs_veracite_at!).toISOString())
        .toBe(new Date(previousTs).toISOString());
    });

    it("user inexistant ⇒ raise P0002 'Producer non trouvé'", async () => {
      const fakeUserId = "00000000-0000-0000-0000-000000000000";
      const { error } = await SUPABASE.rpc(
        "update_producer_onboarding",
        buildArgs({ p_user_id: fakeUserId }),
      );

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Producer non trouvé/);
    });
  },
);

// Test d'intégration SQL — RPC `update_producer_onboarding` (9 args, signature
// post-chantier 3 : retrait des arguments score-carbone / véracité).
//
// La RPC écrit les champs business de l'exploitation et bascule le producteur
// draft → pending, atomiquement. Plus de logique DGCCRF (supprimée chantier 3).
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
    p_nom_exploitation: overrides.p_nom_exploitation ?? "Ferme test chantier-3",
    p_forme_juridique: overrides.p_forme_juridique ?? "ei",
    p_siret: overrides.p_siret ?? "12345678900012",
    p_adresse: overrides.p_adresse ?? "1 rue du Test",
    p_code_postal: overrides.p_code_postal ?? "72000",
    p_commune: overrides.p_commune ?? "Le Mans",
    p_type_production: overrides.p_type_production ?? "elevage",
    p_type_production_precision: overrides.p_type_production_precision ?? null,
  };
}

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

describeIfLocal(
  "update_producer_onboarding (9 args, post-chantier-3)",
  () => {
    let seeded: SeededProducer;

    beforeAll(() => {
      if (!reachable) {
        console.warn(
          "[sql-it] Supabase locale non joignable, tests SQL skippés. " +
            "Lance `npx supabase start` pour exécuter la suite.",
        );
      }
    });

    afterEach(async () => {
      if (seeded) await cleanupProducer(SUPABASE, seeded);
    });

    it("écrit les champs business + bascule statut draft → pending", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "draft" });

      const { error } = await SUPABASE.rpc(
        "update_producer_onboarding",
        buildArgs({
          p_user_id: seeded.userId,
          p_nom_exploitation: "Ferme renommée",
          p_commune: "Allonnes",
        }),
      );
      expect(error).toBeNull();

      const { data, error: selErr } = await SUPABASE
        .from("producers")
        .select("statut, nom_exploitation, commune, siret, type_production")
        .eq("id", seeded.producerId)
        .single();

      expect(selErr).toBeNull();
      expect(data?.statut).toBe("pending");
      expect(data?.nom_exploitation).toBe("Ferme renommée");
      expect(data?.commune).toBe("Allonnes");
      expect(data?.siret).toBe("12345678900012");
      expect(data?.type_production).toBe("elevage");
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

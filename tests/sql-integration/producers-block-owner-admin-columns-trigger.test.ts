// Test F-008 — Trigger `producers_block_owner_admin_columns`
// (audit pré-launch 2026-05-10, finding HAUT).
//
// Cible : BEFORE UPDATE trigger qui bloque les self-updates owner sur les
// colonnes admin-only de `public.producers` (statut, badges, stripe_*, slug,
// user_id, lat/lng, publication_requested_at, bio_validated_at — cf. T-218,
// T-218-bis + chantier 3). bio / bio_certificate_number restent
// producer-writable (le producteur déclare, l'admin valide via bio_validated_at).
//
// Le trigger discrimine sur auth.role() :
//   - service_role → bypass (return new)
//   - is_admin()   → bypass
//   - authenticated owner → RAISE 42501 'producers.<column> is admin-only'
//
// IMPORTANT : ce test verrouille le finding HAUT #8 de l'audit pré-launch.
// Sans lui, un futur refactor du trigger (ex: ajout colonne, migration de
// la fonction trigger, oubli d'une colonne dans la liste admin-only)
// peut casser silencieusement la protection. La lecture pg_trigger côté
// audit verif 2026-05-11 ne couvre PAS la régression (snapshot ≠ filet).
//
// Comportement attendu : RAISE 42501 (insufficient_privilege) avec message
// `producers.<column_name> is admin-only` pour les 25 colonnes verrouillées,
// UPDATE OK pour les colonnes business (nom_exploitation, description, etc.).
//
// Pré-requis : `npx supabase start`.

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
import {
  seedAuthenticatedProducer,
  cleanupAuthenticatedProducerSession,
  type AuthenticatedProducerSession,
} from "./helpers/seed-authenticated-producer";

const SUPABASE = getSqlIntegrationClient();

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

describeIfLocal(
  "producers_block_owner_admin_columns trigger (T-218) — blocage self-update colonnes admin-only",
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

    it("service_role bypass : UPDATE statut autorisé via service_role", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "draft" });

      // Le client SUPABASE est service_role → bypass trigger.
      const { error } = await SUPABASE
        .from("producers")
        .update({ statut: "active" })
        .eq("id", seeded.producerId);

      expect(error).toBeNull();

      const { data } = await SUPABASE
        .from("producers")
        .select("statut")
        .eq("id", seeded.producerId)
        .single();
      expect(data?.statut).toBe("active");
    });

    // ─── F-008 régression : blocage authenticated owner ───────────────
    // Helper canonique : seedAuthenticatedProducer crée user auth + signin
    // + INSERT producer rattaché via user_id. Le client signed-in respecte
    // RLS + triggers comme un acteur PostgREST réel.

    describe("authenticated owner : trigger bloque colonnes admin-only", () => {
      let prodSession: AuthenticatedProducerSession | null = null;

      afterEach(async () => {
        if (prodSession) {
          await cleanupAuthenticatedProducerSession(SUPABASE, prodSession);
          prodSession = null;
        }
      });

      it("UPDATE statut ⇒ raise 42501 admin-only (anti auto-promotion draft→active)", async () => {
        prodSession = await seedAuthenticatedProducer(SUPABASE, {
          statut: "draft",
        });

        const { error } = await prodSession.client
          .from("producers")
          .update({ statut: "active" })
          .eq("id", prodSession.producerId);

        expect(error?.code).toBe("42501");
        expect(error?.message ?? "").toMatch(/producers\.statut is admin-only/i);

        // Verify côté service_role : la row n'a PAS bougé
        const { data } = await SUPABASE
          .from("producers")
          .select("statut")
          .eq("id", prodSession.producerId)
          .single();
        expect(data?.statut).toBe("draft");
      });

      it("UPDATE badge_stock_score ⇒ raise 42501 (anti score badging forgé)", async () => {
        prodSession = await seedAuthenticatedProducer(SUPABASE);

        const { error } = await prodSession.client
          .from("producers")
          .update({ badge_stock_score: 99 })
          .eq("id", prodSession.producerId);

        expect(error?.code).toBe("42501");
        expect(error?.message ?? "").toMatch(
          /producers\.badge_stock_score is admin-only/i,
        );
      });

      it("UPDATE publication_requested_at ⇒ raise 42501 (chantier 3 : seule la RPC request_publication la pose)", async () => {
        prodSession = await seedAuthenticatedProducer(SUPABASE);

        const { error } = await prodSession.client
          .from("producers")
          .update({ publication_requested_at: new Date().toISOString() })
          .eq("id", prodSession.producerId);

        expect(error?.code).toBe("42501");
        expect(error?.message ?? "").toMatch(
          /producers\.publication_requested_at is admin-only/i,
        );
      });

      it("UPDATE bio_validated_at ⇒ raise 42501 (chantier 3 : validation cert bio = acte admin)", async () => {
        prodSession = await seedAuthenticatedProducer(SUPABASE);

        const { error } = await prodSession.client
          .from("producers")
          .update({ bio_validated_at: new Date().toISOString() })
          .eq("id", prodSession.producerId);

        expect(error?.code).toBe("42501");
        expect(error?.message ?? "").toMatch(
          /producers\.bio_validated_at is admin-only/i,
        );
      });

      it("UPDATE bio + bio_certificate_number ⇒ OK (producer-writable, déclaration auto-service)", async () => {
        prodSession = await seedAuthenticatedProducer(SUPABASE);

        const { error } = await prodSession.client
          .from("producers")
          .update({ bio: true, bio_certificate_number: "FR-BIO-01-12345" })
          .eq("id", prodSession.producerId);

        expect(error).toBeNull();

        const { data } = await SUPABASE
          .from("producers")
          .select("bio, bio_certificate_number, bio_validated_at")
          .eq("id", prodSession.producerId)
          .single();
        expect(data?.bio).toBe(true);
        expect(data?.bio_certificate_number).toBe("FR-BIO-01-12345");
        // Déclarer bio ne le valide PAS : bio_validated_at reste null jusqu'à
        // l'acte admin.
        expect(data?.bio_validated_at).toBeNull();
      });

      // ─── T-218-bis régression : lat/lng admin-only ────────────────────
      // Ces 2 tests verrouillent T-218-bis (privacy anti-forge coords
      // producteur). Ils ont été ajoutés après détection d'une régression
      // silencieuse en prod : la migration 20260511000000_p0_sweep_f008 a
      // écrasé les checks lat/lng de T-218-bis pendant qu'elle ajoutait
      // le check enums_version (F-008). La migration corrective
      // 20260512100000_p1_fix_t300_t218bis_regression_trigger a restauré
      // T-218-bis. Cf. doctrine docs/conventions/regression-tests-security.md
      // section "Anti-patterns" pour le pattern à proscrire.

      it("UPDATE latitude ⇒ raise 42501 (T-218-bis anti-forge coords privacy)", async () => {
        prodSession = await seedAuthenticatedProducer(SUPABASE);

        const { error } = await prodSession.client
          .from("producers")
          .update({ latitude: 99.999 })
          .eq("id", prodSession.producerId);

        expect(error?.code).toBe("42501");
        expect(error?.message ?? "").toMatch(
          /producers\.latitude is admin-only/i,
        );
      });

      it("UPDATE longitude ⇒ raise 42501 (T-218-bis anti-forge coords privacy)", async () => {
        prodSession = await seedAuthenticatedProducer(SUPABASE);

        const { error } = await prodSession.client
          .from("producers")
          .update({ longitude: -99.999 })
          .eq("id", prodSession.producerId);

        expect(error?.code).toBe("42501");
        expect(error?.message ?? "").toMatch(
          /producers\.longitude is admin-only/i,
        );
      });

      it("UPDATE nom_exploitation ⇒ OK (colonne business non bloquée)", async () => {
        prodSession = await seedAuthenticatedProducer(SUPABASE, {
          nomExploitation: "Ferme initiale",
        });

        const { error } = await prodSession.client
          .from("producers")
          .update({ nom_exploitation: "Ferme renommée par owner" })
          .eq("id", prodSession.producerId);

        expect(error).toBeNull();

        const { data } = await SUPABASE
          .from("producers")
          .select("nom_exploitation")
          .eq("id", prodSession.producerId)
          .single();
        expect(data?.nom_exploitation).toBe("Ferme renommée par owner");
      });
    });
  },
);

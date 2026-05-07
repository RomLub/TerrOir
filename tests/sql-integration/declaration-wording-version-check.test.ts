// Test scaffold T-296 cible #4 — CHECK constraint
// `declaration_indicateurs_wording_version_check` (T-292).
//
// Cible : whitelist DB des versions de wording certifié DGCCRF, defense-in-depth
// pour rejeter les typos lors d'un bump de version (v1.1 → v.1.1, v11, 1.1).
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

const SUPABASE = getSqlIntegrationClient();

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

describeIfLocal(
  "CHECK declaration_indicateurs_wording_version (T-292) — whitelist v1.0 + v1.1",
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

    it("UPDATE wording_version='v1.0' ⇒ OK (whitelist)", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "draft" });
      const { error } = await SUPABASE
        .from("producers")
        .update({ declaration_indicateurs_wording_version: "v1.0" })
        .eq("id", seeded.producerId);
      expect(error).toBeNull();
    });

    it("UPDATE wording_version='v1.1' ⇒ OK (whitelist)", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "draft" });
      const { error } = await SUPABASE
        .from("producers")
        .update({ declaration_indicateurs_wording_version: "v1.1" })
        .eq("id", seeded.producerId);
      expect(error).toBeNull();
    });

    it("UPDATE wording_version=NULL ⇒ OK (NULL autorisé pour producteurs pré-T-241)", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "draft" });
      const { error } = await SUPABASE
        .from("producers")
        .update({ declaration_indicateurs_wording_version: null })
        .eq("id", seeded.producerId);
      expect(error).toBeNull();
    });

    it("UPDATE wording_version='v.1.1' (typo prefix) ⇒ raise 23514 CHECK violation", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "draft" });
      const { error } = await SUPABASE
        .from("producers")
        .update({ declaration_indicateurs_wording_version: "v.1.1" })
        .eq("id", seeded.producerId);
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    });

    it("UPDATE wording_version='1.0' (sans prefix v) ⇒ raise 23514", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "draft" });
      const { error } = await SUPABASE
        .from("producers")
        .update({ declaration_indicateurs_wording_version: "1.0" })
        .eq("id", seeded.producerId);
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    });

    it("UPDATE wording_version='v2.0' (version future hors whitelist) ⇒ raise 23514", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "draft" });
      const { error } = await SUPABASE
        .from("producers")
        .update({ declaration_indicateurs_wording_version: "v2.0" })
        .eq("id", seeded.producerId);
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    });
  },
);

// Test scaffold T-296 cible #3 — Trigger `producers_block_owner_admin_columns`
// (T-218, blocage 25 colonnes admin-only sur self-update).
//
// Cible : le trigger BEFORE UPDATE qui bloque les self-updates des producteurs
// sur les colonnes admin-only (statut, badges, declaration_indicateurs_*,
// stripe_*, slug, user_id, etc.).
//
// CONTRAINTES DE TEST :
// Ce trigger discrimine sur `auth.role()` :
//   - service_role → bypass (return new)
//   - is_admin() → bypass
//   - authenticated owner → blocage
//
// Le service_role client (helpers/client.ts) bypasse naturellement le trigger.
// Pour reproduire le cas authenticated owner, on doit appeler la DB via une
// session JWT user — le test utilise `SET LOCAL ROLE` + `SET LOCAL request.jwt.claims`
// pour simuler le contexte authenticated dans une transaction RAW SQL.
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

    // TODO scaffolding : tester le blocage authenticated owner nécessite une
    // session JWT (login via supabase.auth.signInWithPassword puis appel via
    // un client anon avec ce JWT). Helper à factoriser dans helpers/auth.ts
    // (créer un user, login, retourner un client authenticated).
    //
    // Cas attendus une fois le helper en place :
    // - UPDATE statut comme owner ⇒ raise '42501 producers.statut is admin-only'
    // - UPDATE badge_stock_score comme owner ⇒ raise '42501'
    // - UPDATE declaration_indicateurs_snapshot comme owner ⇒ raise '42501'
    // - UPDATE nom_exploitation comme owner ⇒ OK (colonne business non bloquée)
    it.todo("authenticated owner : UPDATE statut ⇒ raise 42501 admin-only");
    it.todo("authenticated owner : UPDATE badge_stock_score ⇒ raise 42501");
    it.todo("authenticated owner : UPDATE declaration_indicateurs_snapshot ⇒ raise 42501");
    it.todo("authenticated owner : UPDATE nom_exploitation ⇒ OK (non bloqué)");
  },
);

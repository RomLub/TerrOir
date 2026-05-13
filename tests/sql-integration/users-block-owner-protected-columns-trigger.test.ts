// Test F-009 — Trigger `users_block_owner_protected_columns_trigger`
// (audit pré-launch 2026-05-10, finding HAUT).
//
// Cible : BEFORE UPDATE trigger qui bloque les self-updates owner sur 6
// colonnes admin-only de `public.users` :
//   - roles            (auto-promotion consumer→producer bloquée)
//   - email            (cohérence Stripe Customer + audit forensique)
//   - id               (immutable)
//   - stripe_customer_id (lien Stripe)
//   - cgu_accepted_at  (snapshot juridique CGU/CGV)
//   - cgu_version      (snapshot juridique CGU/CGV)
//
// Bypass : service_role + is_admin().
//
// IMPORTANT : ce test verrouille la critique #7 de l'audit pré-launch. Sans
// lui, un futur refactor du trigger peut casser silencieusement (la lecture
// pg_trigger côté audit verif 2026-05-11 ne couvre PAS la régression).
//
// Pré-requis : `npx supabase start`.

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getSqlIntegrationClient,
  isLocalSupabaseReachable,
} from "./helpers/client";
import {
  seedAuthenticatedClient,
  cleanupAuthenticatedSession,
  type AuthenticatedSession,
} from "./helpers/auth";

const SUPABASE = getSqlIntegrationClient();

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

const ERRCODE_INSUFFICIENT_PRIVILEGE = "42501";

describeIfLocal(
  "users_block_owner_protected_columns_trigger (F-009) — blocage self-update colonnes admin-only",
  () => {
    let session: AuthenticatedSession;

    beforeAll(() => {
      if (!reachable) {
        console.warn(
          "[F-009] Supabase locale non joignable, tests SQL skippés. " +
            "Lance `npx supabase start` pour exécuter la suite.",
        );
      }
    });

    afterEach(async () => {
      if (session) await cleanupAuthenticatedSession(SUPABASE, session);
    });

    it("service_role bypass : UPDATE roles autorisé via service_role", async () => {
      session = await seedAuthenticatedClient(SUPABASE);

      // Via service_role, le trigger bypass (auth.role() = 'service_role').
      const { error } = await SUPABASE
        .from("users")
        .update({ roles: ["consumer", "producer"] })
        .eq("id", session.userId);

      expect(error).toBeNull();

      const { data } = await SUPABASE
        .from("users")
        .select("roles")
        .eq("id", session.userId)
        .single();
      expect(data?.roles).toEqual(["consumer", "producer"]);
    });

    it("authenticated owner : UPDATE roles ⇒ raise 42501 (F-009 auto-promotion)", async () => {
      session = await seedAuthenticatedClient(SUPABASE);

      // Tentative critique de l'audit : consumer s'auto-promeut producer
      // via UPDATE direct PostgREST.
      const { error } = await session.client
        .from("users")
        .update({ roles: ["consumer", "producer"] })
        .eq("id", session.userId);

      expect(error).not.toBeNull();
      expect(error?.code).toBe(ERRCODE_INSUFFICIENT_PRIVILEGE);
      expect(error?.message ?? "").toMatch(/roles is admin-only/i);

      // Verify : la row n'a PAS été modifiée
      const { data } = await SUPABASE
        .from("users")
        .select("roles")
        .eq("id", session.userId)
        .single();
      expect(data?.roles).toEqual(["consumer"]);
    });

    it("authenticated owner : UPDATE email ⇒ raise 42501", async () => {
      session = await seedAuthenticatedClient(SUPABASE);

      const { error } = await session.client
        .from("users")
        .update({ email: "attacker-controlled@evil.test" })
        .eq("id", session.userId);

      expect(error?.code).toBe(ERRCODE_INSUFFICIENT_PRIVILEGE);
      expect(error?.message ?? "").toMatch(/email is admin-only/i);
    });

    it("authenticated owner : UPDATE stripe_customer_id ⇒ raise 42501", async () => {
      session = await seedAuthenticatedClient(SUPABASE);

      const { error } = await session.client
        .from("users")
        .update({ stripe_customer_id: "cus_attacker_forged" })
        .eq("id", session.userId);

      expect(error?.code).toBe(ERRCODE_INSUFFICIENT_PRIVILEGE);
      expect(error?.message ?? "").toMatch(/stripe_customer_id is admin-only/i);
    });

    it("authenticated owner : UPDATE cgu_accepted_at ⇒ raise 42501 (snapshot juridique)", async () => {
      session = await seedAuthenticatedClient(SUPABASE);

      // Set via service_role d'abord pour avoir une valeur initiale non-null
      await SUPABASE
        .from("users")
        .update({ cgu_accepted_at: new Date("2026-01-01").toISOString() })
        .eq("id", session.userId);

      const { error } = await session.client
        .from("users")
        .update({ cgu_accepted_at: new Date("2026-01-02").toISOString() })
        .eq("id", session.userId);

      expect(error?.code).toBe(ERRCODE_INSUFFICIENT_PRIVILEGE);
      expect(error?.message ?? "").toMatch(/cgu_accepted_at is admin-only/i);
    });

    it("authenticated owner : UPDATE cgu_version ⇒ raise 42501 (snapshot juridique)", async () => {
      session = await seedAuthenticatedClient(SUPABASE);

      await SUPABASE
        .from("users")
        .update({ cgu_version: "v1.0" })
        .eq("id", session.userId);

      const { error } = await session.client
        .from("users")
        .update({ cgu_version: "v2.0-fake" })
        .eq("id", session.userId);

      expect(error?.code).toBe(ERRCODE_INSUFFICIENT_PRIVILEGE);
      expect(error?.message ?? "").toMatch(/cgu_version is admin-only/i);
    });

    it("authenticated owner : UPDATE prenom ⇒ OK (colonne profil non bloquée)", async () => {
      session = await seedAuthenticatedClient(SUPABASE);

      const { error } = await session.client
        .from("users")
        .update({ prenom: "Jean" })
        .eq("id", session.userId);

      expect(error).toBeNull();

      const { data } = await SUPABASE
        .from("users")
        .select("prenom")
        .eq("id", session.userId)
        .single();
      expect(data?.prenom).toBe("Jean");
    });
  },
);

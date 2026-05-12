import type { SupabaseClient } from "@supabase/supabase-js";
import { getSqlIntegrationAnonClient } from "./client";

// Helper authenticated client pour tests SQL-integration.
//
// Permet de reproduire le contexte `authenticated` (auth.uid() = user_id,
// auth.role() = 'authenticated') depuis un test SQL-integration. Sans ce
// helper, les tests ne peuvent valider que le bypass `service_role`, pas
// les protections owner-side (cf. F-001 RLS orders, F-008 trigger producers,
// F-009 trigger users — audit pré-launch 2026-05-10).
//
// Pattern : on crée un user via service_role admin API, on login via un
// client anon `signInWithPassword`, et on retourne le client anon signed-in.
// Ce client respecte RLS + triggers exactement comme un acteur PostgREST réel.

export type AuthenticatedSession = {
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient; // anon client signed-in (RLS s'applique)
};

const TEST_PASSWORD = "test-password-sql-integration-2026";

export async function seedAuthenticatedClient(
  adminClient: SupabaseClient,
  overrides?: { emailPrefix?: string },
): Promise<AuthenticatedSession> {
  const prefix = overrides?.emailPrefix ?? "auth-test";
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@test.local`;

  // 1. Création user auth.users via service_role admin API
  const { data: authData, error: authErr } = await adminClient.auth.admin
    .createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
  if (authErr || !authData.user) {
    throw new Error(
      `seedAuthenticatedClient auth.createUser failed: ${authErr?.message}`,
    );
  }
  const userId = authData.user.id;

  // 2. INSERT public.users (pas de trigger auto-INSERT auth.users→public.users
  //    dans TerrOir — flow normal passe par accept-invitation / login-and-upgrade
  //    server actions). Via service_role pour bypass trigger
  //    `users_block_owner_protected_columns_trigger` (F-009).
  const { error: pubErr } = await adminClient.from("users").insert({
    id: userId,
    email,
    roles: ["consumer"],
  });
  if (pubErr) {
    // Cleanup auth user puis raise
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(
      `seedAuthenticatedClient public.users insert failed: ${pubErr.message}`,
    );
  }

  // 3. Login via anon client → on récupère un client signed-in qui passe
  //    par RLS comme un acteur authenticated réel
  const client = getSqlIntegrationAnonClient();
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInErr) {
    await adminClient.from("users").delete().eq("id", userId);
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(
      `seedAuthenticatedClient signInWithPassword failed: ${signInErr.message}`,
    );
  }

  return { userId, email, password: TEST_PASSWORD, client };
}

export async function cleanupAuthenticatedSession(
  adminClient: SupabaseClient,
  session: AuthenticatedSession,
): Promise<void> {
  // Sign out le client anon (libère la session JWT)
  await session.client.auth.signOut().catch(() => undefined);

  // Cleanup public.users + auth.users via service_role
  await adminClient.from("users").delete().eq("id", session.userId);
  await adminClient.auth.admin.deleteUser(session.userId);
}

/**
 * Helpers de cycle de vie user pour tests E2E.
 *
 *   createTestUser(ctx, options?) : crée un user via auth.admin, push id
 *     et email dans les Sets trackés, retourne {id, email, password}.
 *
 *   loginAs(page, user) : bypass UI login en setant directement les cookies
 *     de session Supabase (gain ~5s par test, pas de quota Resend gaspillé).
 *
 *   cleanupTestUser(ctx, userId) : supprime tous les rows liés au user via
 *     safeDelete chaînés (sessions, otp_codes, undo_tokens, public.users,
 *     audit_logs perso, et auth.users via auth.admin.deleteUser).
 */

import type { Page } from '@playwright/test';
import {
  TestContext,
  getRawAdminClient,
  safeDelete,
  trackId,
  trackEmail,
} from './supabase-admin';
import { generateTestEmail } from './guards';

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

interface CreateTestUserOptions {
  /** Suffix optionnel pour identifier l'usage de l'user dans les logs. */
  suffix?: string;
  /** Override du password. Default : password aléatoire 16 chars. */
  password?: string;
  /** Si true, l'email est auto-confirmé (pas besoin de magic link). Default true. */
  emailConfirmed?: boolean;
}

function generatePassword(): string {
  // 16 chars aléatoires alphanumeric. Suffisant pour un user de test.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let pwd = '';
  for (let i = 0; i < 16; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  // Garantir au moins 1 chiffre + 1 lettre (Supabase peut avoir des règles)
  return 'A1' + pwd;
}

/**
 * Crée un user de test via auth.admin (Supabase service_role).
 * Push automatiquement id + email dans le contexte tracké.
 */
export async function createTestUser(
  ctx: TestContext,
  options: CreateTestUserOptions = {},
): Promise<TestUser> {
  const email = generateTestEmail(options.suffix);
  const password = options.password ?? generatePassword();
  const emailConfirmed = options.emailConfirmed ?? true;

  const admin = getRawAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: emailConfirmed,
  });

  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? 'no user returned'}`);
  }

  const user: TestUser = {
    id: data.user.id,
    email,
    password,
  };

  // Track AVANT de retourner : safeDelete pourra cibler cet id ensuite
  trackId(ctx, user.id);
  trackEmail(ctx, user.email);

  return user;
}

/**
 * Bypass UI login : génère une session via auth.admin et set les cookies
 * Supabase directement dans le contexte browser Playwright.
 *
 * Cette fonction NE TESTE PAS le flow de login (c'est volontaire, hors scope
 * ChangeEmailSection). Le flow login UI sera testé en phase 2 via un smoke
 * dédié signup → magic link Resend → click → arrivée loggé.
 */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  const admin = getRawAdminClient();

  // Génère un magic link mais on ne l'envoie pas par mail : on extrait
  // directement les tokens via la propriété `properties.action_link` de
  // la response, ou plus proprement via signInWithPassword côté admin.
  // Approche retenue : signInWithPassword via un client temporaire user-side.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY manquant dans .env.local');
  }

  // Import dynamique pour éviter de créer un autre singleton
  const { createClient } = await import('@supabase/supabase-js');
  const userClient = createClient(url, anonKey);
  const { data, error } = await userClient.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });

  if (error || !data.session) {
    throw new Error(`loginAs failed: ${error?.message ?? 'no session returned'}`);
  }

  // Inject tokens dans le browser Playwright via localStorage
  // (Supabase JS client utilise localStorage par défaut côté client).
  const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) {
    throw new Error(`Impossible d'extraire le project ref depuis ${url}`);
  }
  const storageKey = `sb-${projectRef}-auth-token`;
  const sessionPayload = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
    user: data.session.user,
  };

  // Le browser doit être déjà sur le bon domaine pour que localStorage soit accessible.
  // Si on n'est sur aucune page, navigate d'abord vers /
  if (!page.url() || page.url() === 'about:blank') {
    await page.goto('/');
  }

  await page.evaluate(
    ({ key, payload }) => {
      window.localStorage.setItem(key, JSON.stringify(payload));
    },
    { key: storageKey, payload: sessionPayload },
  );

  // Refresh pour que Supabase JS pickup la session depuis localStorage
  await page.reload();
}

/**
 * Cleanup intégral d'un user de test.
 * Ordre des deletes (FK respect) :
 *   1. email_change_undo_tokens (FK user_id)
 *   2. email_change_otp_codes (FK user_id)
 *   3. audit_logs (FK user_id) — soft, on log mais on continue si fail
 *   4. public.users (FK auth.users.id)
 *   5. auth.users via auth.admin.deleteUser (cascade sessions, refresh_tokens)
 *
 * NB : auth.users.deleteUser cascade sur auth.sessions, auth.refresh_tokens,
 * auth.identities. Pas besoin de les delete manuellement.
 */
export async function cleanupTestUser(ctx: TestContext, userId: string): Promise<void> {
  if (!ctx.trackedIds.has(userId)) {
    throw new Error(
      `cleanupTestUser: userId ${userId} non tracké dans le contexte du test "${ctx.testId}". ` +
      `Refus par sécurité.`,
    );
  }

  // 1. email_change_undo_tokens
  await safeDelete(ctx, 'email_change_undo_tokens', { user_id: userId }).catch((err) => {
    console.warn(`[cleanup] email_change_undo_tokens failed for ${userId}:`, err);
  });

  // 2. email_change_otp_codes
  await safeDelete(ctx, 'email_change_otp_codes', { user_id: userId }).catch((err) => {
    console.warn(`[cleanup] email_change_otp_codes failed for ${userId}:`, err);
  });

  // 3. audit_logs : DELETE pour eviter de polluer la table audit
  //    en prod avec des events de tests (decision finale : pas de
  //    soft retention).
  await safeDelete(ctx, 'audit_logs', { user_id: userId }).catch((err) => {
    console.warn(`[cleanup] audit_logs failed for ${userId}:`, err);
  });

  // 4. public.users (cascade depuis auth.users normalement, mais on est défensif)
  await safeDelete(ctx, 'users', { id: userId }).catch((err) => {
    // Si c'est une erreur de FK car auth.users existe encore, c'est OK
    // car le step 5 va cascade. On log silencieusement.
    if (process.env.PLAYWRIGHT_VERBOSE) {
      console.warn(`[cleanup] public.users failed for ${userId} (probably FK):`, err);
    }
  });

  // 5. auth.users via admin API (cascade sur sessions, refresh_tokens, identities)
  const admin = getRawAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`[cleanup] auth.admin.deleteUser failed for ${userId}:`, error);
    // On throw ici parce qu'un user résiduel en auth.users est un vrai problème
    throw new Error(`cleanupTestUser: auth.admin.deleteUser failed: ${error.message}`);
  }
}

/**
 * Cleanup TOUS les UUIDs trackés dans le contexte. Appelé en afterEach.
 */
export async function cleanupAllTrackedUsers(ctx: TestContext): Promise<void> {
  const ids = [...ctx.trackedIds];
  for (const id of ids) {
    try {
      await cleanupTestUser(ctx, id);
    } catch (err) {
      console.error(`[cleanup] failed for ${id}:`, err);
      // On continue le cleanup des autres users même si un échoue
    }
  }
  ctx.trackedIds.clear();
  ctx.trackedEmails.clear();
}

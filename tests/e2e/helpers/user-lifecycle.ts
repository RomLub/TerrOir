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
  trackUserId,
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
 * Crée un user de test via auth.admin (Supabase service_role) + reproduit
 * le pattern signup prod en INSERT-ant la row public.users associée.
 *
 * Pas de trigger DB qui crée public.users automatiquement (cf. migration
 * 20260419000000_initial_schema) : le code prod fait l'INSERT manuel après
 * signUp (cf. app/(consumer)/auth/inscription/actions.ts:102-110). Pour
 * que le helper produise un user cohérent avec un signup réel, on
 * reproduit ce pattern ici.
 *
 * Cleanup : public.users est purgée automatiquement via la FK
 * `id REFERENCES auth.users(id) ON DELETE CASCADE` quand cleanupTestUser
 * appelle auth.admin.deleteUser(userId) — pas besoin de delete explicite.
 *
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

  // Track AVANT l'INSERT public.users : si l'INSERT fail, l'afterEach
  // cleanupAllTrackedUsers pourra purger l'auth.users orphelin via le id tracké.
  trackUserId(ctx, user.id);
  trackEmail(ctx, user.email);

  // Reproduit le pattern signup prod (actions.ts:102-110). Fail-fast :
  // un user half-created (auth.users sans public.users) est un état
  // corrompu qu'on ne veut pas masquer dans les tests.
  const { error: profileError } = await admin.from('users').insert({
    id: user.id,
    email: user.email,
    roles: ['consumer'],
  });
  if (profileError) {
    throw new Error(
      `createTestUser INSERT public.users failed: ${profileError.message}`,
    );
  }

  return user;
}

/**
 * Login UI rapide via /connexion en mode password.
 *
 * Le projet utilise @supabase/ssr (App Router) qui stocke la session
 * dans des cookies HTTP, pas dans localStorage. Le seul moyen fiable
 * de poser ces cookies sans dépendre du format interne (qui peut
 * changer entre versions du SDK) est de traverser le formulaire de
 * login : la server action loginAction posera les cookies via
 * createSupabaseServerClient() comme pour un vrai user.
 *
 * Coût ~2-3s par test, pas de mail Resend gaspillé (password mode,
 * pas magic link). Bonus : ce flow valide aussi le login en passant.
 *
 * Marqueur de fin : on quitte /connexion (resolvePostLoginPath redirige
 * vers /compte ou la cible redirectTo selon le rôle).
 */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/connexion');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
  await page
    .getByRole('button', { name: 'Se connecter', exact: true })
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith('/connexion'));
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
  if (!ctx.trackedUserIds.has(userId)) {
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
 * Cleanup TOUS les users trackés dans le contexte. Appelé en afterEach.
 *
 * N'itère que sur trackedUserIds : la FK user_id ON DELETE CASCADE purge
 * automatiquement les rows applicatives (trackedRowIds) quand auth.admin.deleteUser
 * supprime l'user parent. Le clear final reset les 3 Sets.
 */
export async function cleanupAllTrackedUsers(ctx: TestContext): Promise<void> {
  const ids = [...ctx.trackedUserIds];
  for (const id of ids) {
    try {
      await cleanupTestUser(ctx, id);
    } catch (err) {
      console.error(`[cleanup] failed for ${id}:`, err);
      // On continue le cleanup des autres users même si un échoue
    }
  }
  ctx.trackedUserIds.clear();
  ctx.trackedRowIds.clear();
  ctx.trackedEmails.clear();
}

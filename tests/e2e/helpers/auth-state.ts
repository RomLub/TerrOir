/**
 * Auth-state helper E2E — orchestration des storageState pré-calculés
 * pour les persona "readonly" partagés entre tests.
 *
 * Doctrine TerrOir e2e :
 *   - Tests qui MUTENT le user (signup, change-email, change-password,
 *     delete-account) → user éphémère via createTestUser (pas de storageState).
 *   - Tests qui consomment l'user en READ ONLY → storageState pré-calculé
 *     pour économiser ~3s de login UI à chaque test.
 *
 * 3 personas pré-calculés :
 *   - consumer-readonly@... : rôle ['consumer'], pas d'orders mutées
 *   - producer-readonly@... : rôle ['consumer','producer'], producer.statut='public'
 *   - admin@...             : rôle ['consumer'], admin_users.user_id présent
 *
 * Lifecycle :
 *   - global-setup : ensurePersistentUser × 3 + login UI + save storageState
 *   - tests : project-scope `use: { storageState: AUTH_STATE_PATHS.consumer }`
 *   - global-teardown : delete les 3 persona persistants + cleanup résiduels
 *
 * NOTE Phase 1 : helper créé prêt à l'emploi mais pas encore consommé par
 * les tests pilotes (lazy generation Phase 2 quand premiers tests
 * authenticated arrivent). global-setup Phase 1 valide juste les env vars
 * et appelle sweepE2EResiduals.
 */

import path from 'path';
import { promises as fs } from 'fs';
import type { Page } from '@playwright/test';
import { getRawAdminClient } from './supabase-admin';

export type PersistentRole = 'consumer' | 'producer' | 'admin';

const AUTH_STATE_DIR = path.resolve(
  __dirname,
  '..',
  'setup',
  'auth-state',
);

export const AUTH_STATE_PATHS: Record<PersistentRole, string> = {
  consumer: path.join(AUTH_STATE_DIR, 'consumer.json'),
  producer: path.join(AUTH_STATE_DIR, 'producer.json'),
  admin: path.join(AUTH_STATE_DIR, 'admin.json'),
};

// Emails fixes pour les persona persistants. Hors allow-list générique mais
// listés ici comme noms réservés. Le pattern ALLOW_PATTERN couvre déjà ces
// emails (playwright-test-{ts}-{suffix}@mailinator.com).
//
// NB : on utilise des timestamps fixes par persona (pas Date.now()) pour
// que les emails restent stables entre runs et que `ensurePersistentUser`
// les retrouve via auth.admin.listUsers.
const PERSISTENT_EMAILS: Record<PersistentRole, string> = {
  consumer: 'playwright-test-1700000001-consumer-readonly@mailinator.com',
  producer: 'playwright-test-1700000002-producer-readonly@mailinator.com',
  admin: 'playwright-test-1700000003-admin-readonly@mailinator.com',
};

const PERSISTENT_PASSWORD = 'A1eXR5tq8ZpL3vBn'; // 16 chars, alphanumeric

export interface PersistentUser {
  id: string;
  email: string;
  password: string;
  role: PersistentRole;
}

interface AuthAdminListUserRow {
  id: string;
  email?: string | null;
}

/**
 * Idempotent : retourne le user persistant existant ou le crée + assigne
 * le rôle attendu. Préfère listUsers à un .from('users').select pour ne
 * pas dépendre de RLS.
 */
export async function ensurePersistentUser(role: PersistentRole): Promise<PersistentUser> {
  const email = PERSISTENT_EMAILS[role];
  const admin = getRawAdminClient();

  // 1. Tentative lookup via auth.admin.listUsers
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    throw new Error(`ensurePersistentUser ${role}: listUsers failed: ${listErr.message}`);
  }
  let userId: string | undefined = (list?.users as AuthAdminListUserRow[] | undefined)?.find(
    (u) => u.email === email,
  )?.id;

  // 2. Crée si absent
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PERSISTENT_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(
        `ensurePersistentUser ${role}: createUser failed: ${error?.message ?? 'no user'}`,
      );
    }
    userId = data.user.id;

    // INSERT public.users SAUF si role='admin'. Le trigger d'exclusivité
    // `users_exclusive_with_admin` (migration 20260421100000) bloque la
    // co-existence d'une row public.users et admin_users pour le même id.
    // Pour role='admin' on saute donc public.users — l'INSERT admin_users
    // suit en step 4. Détecté par teammates Phase 4 admin-core et admin-
    // categorisation (qui ont contourné via helper local pendant Phase 4).
    if (role !== 'admin') {
      const { error: profileErr } = await admin.from('users').insert({
        id: userId,
        email,
        roles: role === 'producer' ? ['consumer', 'producer'] : ['consumer'],
      });
      if (profileErr) {
        throw new Error(
          `ensurePersistentUser ${role}: INSERT public.users failed: ${profileErr.message}`,
        );
      }
    }
  } else if (role !== 'admin') {
    // 3. Idempotence : sync rôle pour consumer/producer existants. Ne tente
    // pas l'UPDATE pour admin (la row public.users n'existe pas par design,
    // cf. trigger users_exclusive_with_admin).
    const targetRoles = role === 'producer' ? ['consumer', 'producer'] : ['consumer'];
    await admin.from('users').update({ roles: targetRoles }).eq('id', userId);
  }

  // 4. admin_users hookup si role=admin. Le schema TerrOir utilise `id`
  // (PK = auth.users.id, pas une colonne user_id séparée). Cf. migration
  // 20260421100000_cumulative_roles_admin_users.
  if (role === 'admin') {
    const { data: adminRow } = await admin
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (!adminRow) {
      const { error: insErr } = await admin
        .from('admin_users')
        .insert({ id: userId });
      if (insErr) {
        throw new Error(`ensurePersistentUser admin: admin_users insert: ${insErr.message}`);
      }
    }
  }

  return { id: userId, email, password: PERSISTENT_PASSWORD, role };
}

/**
 * Login UI sur /connexion avec un user persistant + save storageState
 * dans le path attendu par les projects Playwright.
 */
export async function captureAuthState(page: Page, user: PersistentUser): Promise<string> {
  await fs.mkdir(AUTH_STATE_DIR, { recursive: true });

  await page.goto('/connexion');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
  await page
    .getByRole('button', { name: 'Se connecter', exact: true })
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith('/connexion'));

  const targetPath = AUTH_STATE_PATHS[user.role];
  await page.context().storageState({ path: targetPath });
  return targetPath;
}

/**
 * Lit le storageState JSON pré-calculé pour un rôle. Throw si absent
 * (signal qu'il faut un global-setup).
 */
export async function loadAuthState(role: PersistentRole): Promise<string> {
  const target = AUTH_STATE_PATHS[role];
  try {
    await fs.access(target);
    return target;
  } catch {
    throw new Error(
      `auth-state ${role} introuvable à ${target} — lancer global-setup ` +
      `(automatique au démarrage Playwright) ou captureAuthState manuellement.`,
    );
  }
}

/**
 * Cleanup intégral des 3 persona persistants. Appelé par global-teardown.
 * Robuste : continue même si un user manque ou si un delete échoue.
 */
export async function cleanupPersistentUsers(): Promise<{ deleted: PersistentRole[]; errors: string[] }> {
  const admin = getRawAdminClient();
  const deleted: PersistentRole[] = [];
  const errors: string[] = [];

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    return { deleted, errors: [`listUsers: ${listErr.message}`] };
  }

  for (const role of Object.keys(PERSISTENT_EMAILS) as PersistentRole[]) {
    const email = PERSISTENT_EMAILS[role];
    const found = (list?.users as AuthAdminListUserRow[] | undefined)?.find(
      (u) => u.email === email,
    );
    if (!found) continue;
    try {
      await admin.from('producers').delete().eq('user_id', found.id);
      await admin.from('admin_users').delete().eq('id', found.id);
      await admin.from('users').delete().eq('id', found.id);
      const { error: delErr } = await admin.auth.admin.deleteUser(found.id);
      if (delErr) {
        errors.push(`${role} delete: ${delErr.message}`);
      } else {
        deleted.push(role);
      }
    } catch (err) {
      errors.push(`${role} cleanup exception: ${(err as Error).message}`);
    }
  }

  // Cleanup storageState files (idempotent)
  for (const role of Object.keys(AUTH_STATE_PATHS) as PersistentRole[]) {
    try {
      await fs.unlink(AUTH_STATE_PATHS[role]);
    } catch {
      /* file absent, ignore */
    }
  }

  return { deleted, errors };
}

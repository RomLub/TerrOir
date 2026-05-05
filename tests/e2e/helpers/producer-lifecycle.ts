/**
 * Helpers de cycle de vie producer pour tests E2E.
 *
 * createTestProducer(ctx, options?) : crée un user via createTestUser, lui
 * upgrade le rôle ['consumer','producer'], puis INSERT une row producers
 * minimale (statut 'draft' par défaut). Retourne {user, producerId, slug}.
 *
 * Cleanup : zéro action explicite — auth.users CASCADE sur public.users.id
 * et producers.user_id (cf. migration 20260421 + comment dans
 * app/(producer)/invitation/_actions/create-account.ts:127). Le helper
 * cleanupAllTrackedUsers (afterEach) appelle auth.admin.deleteUser, le row
 * producer disparaît automatiquement.
 */

import { getRawAdminClient, trackRowId, type TestContext } from './supabase-admin';
import { createTestUser, type TestUser } from './user-lifecycle';

export interface TestProducer {
  user: TestUser;
  producerId: string;
  slug: string;
}

interface CreateTestProducerOptions {
  /** Suffix optionnel pour identifier l'usage dans les logs / email tracké. */
  suffix?: string;
  /** Statut producer. Default 'draft' (cohérent avec un fresh onboard). */
  statut?: 'draft' | 'public' | 'active';
  /** Override nom_exploitation. Default 'Test Producer {timestamp}'. */
  nomExploitation?: string;
}

export async function createTestProducer(
  ctx: TestContext,
  options: CreateTestProducerOptions = {},
): Promise<TestProducer> {
  const user = await createTestUser(ctx, { suffix: options.suffix ?? 'producer' });
  const admin = getRawAdminClient();

  const { error: roleError } = await admin
    .from('users')
    .update({ roles: ['consumer', 'producer'] })
    .eq('id', user.id);
  if (roleError) {
    throw new Error(`createTestProducer roles upgrade failed: ${roleError.message}`);
  }

  const ts = Date.now();
  const slug = `playwright-test-${ts}-${(options.suffix ?? 'prod').slice(0, 12)}`;
  const nomExploitation = options.nomExploitation ?? `Test Producer ${ts}`;

  const { data, error } = await admin
    .from('producers')
    .insert({
      user_id: user.id,
      slug,
      prenom_affichage: 'Test',
      nom_exploitation: nomExploitation,
      statut: options.statut ?? 'draft',
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`createTestProducer insert producers failed: ${error?.message}`);
  }

  trackRowId(ctx, data.id);

  return { user, producerId: data.id, slug };
}

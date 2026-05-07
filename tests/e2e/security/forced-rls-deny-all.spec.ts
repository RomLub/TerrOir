/**
 * E2E security/forced-rls-deny-all — vérifie que la table
 * `test_emails_captured` est bien DENY pour anon et authenticated.
 *
 * Migration de référence : 20260507220000_e2e_test_emails_captured.sql
 * Pattern doctrine FORCE RLS TerrOir (CLAUDE.md) :
 *   - ENABLE ROW LEVEL SECURITY
 *   - Policy "deny_all" explicite USING(false) WITH CHECK(false) pour public
 *   - REVOKE ALL FROM anon/authenticated/PUBLIC
 *   - GRANT ALL TO service_role
 *
 * Critère : un client anon (et un client authenticated consumer) doit recevoir
 * une erreur ou une liste vide sur SELECT — JAMAIS la moindre ligne stockée
 * (les emails capturés contiennent du HTML potentiellement avec liens OTP).
 *
 * Couverture (1 test) : 3 assertions consécutives :
 *   1. SELECT anon → 0 row (RLS deny)
 *   2. SELECT authenticated consumer → 0 row (même policy)
 *   3. INSERT authenticated consumer → erreur (REVOKE INSERT explicite)
 */

import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../helpers/test-context';
import { seedConsumer } from '../helpers/db-seed';
import { getRawAdminClient, trackRowId } from '../helpers/supabase-admin';

function makeAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

test.describe('Security — Forced RLS deny-all (test_emails_captured)', () => {
  test('SELECT anon + SELECT authenticated + INSERT authenticated → tous bloqués', async ({
    ctx,
  }) => {
    test.setTimeout(60_000);

    // Seed : on insère via service_role 1 row de canary marker pour s'assurer
    // que la table contient AU MOINS une ligne — sinon un SELECT vide ne
    // prouverait rien (la table pourrait être simplement vide).
    const admin = getRawAdminClient();
    const marker = `rls-deny-canary-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const canaryEmail = `playwright-test-${Date.now()}-rls-canary@mailinator.com`;
    const { data: canaryRow, error: insErr } = await admin
      .from('test_emails_captured')
      .insert({
        to_email: canaryEmail,
        from_email: 'noreply@terroir-local.fr',
        subject: 'RLS deny-all canary',
        template: 'rls-canary',
        html: `<p>${marker}</p>`,
        metadata: { marker },
      })
      .select('id')
      .single();
    expect(insErr, `service_role doit pouvoir INSERT: ${insErr?.message}`).toBeNull();
    if (canaryRow) trackRowId(ctx, canaryRow.id as string);

    try {
      // ── 1. Client anon : SELECT doit renvoyer 0 row ──
      // RLS deny-all pour role public (anon hérite). PostgREST renvoie soit
      // une erreur (permission denied), soit une liste vide selon la
      // version. Critère : data?.length === 0 OU error truthy. Surtout :
      // jamais une ligne contenant le marker.
      const anonClient = makeAnonClient();
      const { data: anonData, error: anonErr } = await anonClient
        .from('test_emails_captured')
        .select('id, to_email, subject');
      // On accepte les deux comportements (error 401/403 OR empty array).
      // Critère anti-leak strict : si data est non-null, doit être [].
      if (anonErr) {
        // OK : RLS / GRANT a bien refusé.
        expect(anonErr.message.length).toBeGreaterThan(0);
      } else {
        expect(
          anonData ?? [],
          `LEAK: anon ne doit voir aucune ligne de test_emails_captured`,
        ).toEqual([]);
      }

      // ── 2. Client authenticated consumer : même verdict ──
      const consumer = await seedConsumer(ctx, { suffix: 'rls-deny' });
      const { error: signInErr } = await anonClient.auth.signInWithPassword({
        email: consumer.email,
        password: consumer.password,
      });
      expect(signInErr, signInErr?.message).toBeNull();

      const { data: authData, error: authErr } = await anonClient
        .from('test_emails_captured')
        .select('id, to_email, subject');
      if (authErr) {
        expect(authErr.message.length).toBeGreaterThan(0);
      } else {
        expect(
          authData ?? [],
          `LEAK: consumer authentifié ne doit voir aucune ligne de test_emails_captured`,
        ).toEqual([]);
      }

      // ── 3. INSERT authenticated → erreur (REVOKE INSERT explicite) ──
      const { error: insertErr } = await anonClient
        .from('test_emails_captured')
        .insert({
          to_email: 'playwright-test-9999999999-attack@mailinator.com',
          from_email: 'attacker@example.com',
          subject: 'Attempted INSERT',
          template: 'attack',
          html: '<p>should not insert</p>',
        });
      expect(
        insertErr,
        `INSERT par client authenticated DOIT être bloqué (RLS deny-all + REVOKE)`,
      ).not.toBeNull();

      await anonClient.auth.signOut();

      // Sanity check : le marker existe toujours côté service_role (preuve
      // que la table n'est pas juste vide).
      const { data: serviceCheck } = await admin
        .from('test_emails_captured')
        .select('id, metadata')
        .eq('id', canaryRow!.id as string);
      expect(
        (serviceCheck ?? []).length,
        `service_role doit toujours voir le canary`,
      ).toBe(1);
    } finally {
      // Cleanup explicit du canary (la table est aussi purgée par
      // global-teardown mais on est défensif).
      if (canaryRow) {
        await admin
          .from('test_emails_captured')
          .delete()
          .eq('id', canaryRow.id as string);
      }
    }
  });
});

/**
 * E2E magic-link login (Phase 2 cycle e2e exhaustif).
 *
 * Couvre 2 tests :
 *   1. happy path : POST formulaire UI MagicLinkForm sur /connexion (mode
 *      magic). Le serveur appelle supabase.auth.signInWithOtp avec
 *      shouldCreateUser=false. L'email magic-link transite par Supabase
 *      Auth (SMTP intégré, PAS via lib/resend) → impossible à intercepter
 *      via RESEND_TEST_MODE / test_emails_captured. Stratégie d'assertion :
 *      audit_logs `account_login_magic_link` avec metadata.email_masked
 *      (cf. app/connexion/actions.ts:276-280). UI affiche le message
 *      enumeration-resistant "Si cette adresse est connue, un lien...".
 *
 *   2. expired token : génère un magiclink via auth.admin.generateLink(),
 *      attend une expiration simulée (on ne peut pas réellement attendre
 *      1h+ en CI), puis exerce le callback /auth/callback avec ce token.
 *      Si la mécanique d'expiration côté Supabase est testable in-band,
 *      on assert sur le redirect vers /connexion?error=auth_callback&reason=expired.
 *      Sinon SKIP avec doc.
 *
 * NB : RESEND_TEST_MODE n'intercepte que sendTemplate (lib/resend/send.ts).
 * signInWithOtp passe par GoTrue → Supabase SMTP, hors du périmètre. Pas
 * de capture de l'email magic-link possible côté tests sans mock SMTP.
 */

import { test, expect } from '../helpers/test-context';
import { createTestUser } from '../helpers/user-lifecycle';
import { getReadOnlyAdminClient } from '../helpers/supabase-admin';

test.describe('Magic-link login', () => {
  test('happy path : requestMagicLinkAction émet audit_log + UI enumeration-resistant', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    // 1. Crée un user existant (magic-link avec shouldCreateUser=false ne
    //    sera fonctionnel que pour un email présent en auth.users).
    const user = await createTestUser(ctx, { suffix: 'magic-happy' });

    // 2. Ouvre /connexion et bascule en mode magic-link (l'UI démarre en
    //    mode password par défaut, cf. ConnexionForm initial state).
    await page.goto('/connexion');
    await page.getByRole('button', { name: 'Se connecter par email' }).click();

    // 3. Attend l'apparition du form magic-link (titre discriminant).
    await expect(
      page.getByRole('heading', { name: 'Se connecter par email' }),
    ).toBeVisible();

    const t0 = new Date().toISOString();

    // 4. Saisit l'email + submit. Le form est soumis via server action
    //    requestMagicLinkAction qui appelle signInWithOtp puis logue
    //    audit_logs account_login_magic_link.
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();

    // 5. UI confirme l'envoi avec le message enumeration-resistant
    //    (même réponse pour email valide ou inexistant).
    await expect(
      page.getByText(
        /Si cette adresse est connue, un lien.*envoyé/i,
      ),
    ).toBeVisible();

    // 6. Assert audit_log : event_type 'account_login_magic_link' loggé
    //    après t0. metadata.email_masked + isAdmin:false attendus.
    //    NB : userId IS NULL pour cet event (préserve enumeration-resistance,
    //    cf. app/connexion/actions.ts:278), donc la lookup se fait par
    //    metadata.email_masked.
    const admin = getReadOnlyAdminClient();
    const expectedMaskedPrefix = user.email.slice(0, 2); // maskEmail garde 2 chars + ***
    const { data: auditLogs, error: auditErr } = await admin
      .from('audit_logs')
      .select('event_type, metadata, created_at, user_id')
      .eq('event_type', 'account_login_magic_link')
      .gte('created_at', t0)
      .order('created_at', { ascending: false })
      .limit(10);
    expect(auditErr).toBeNull();
    expect(auditLogs?.length ?? 0).toBeGreaterThanOrEqual(1);

    // L'audit log peut contenir d'autres tentatives en parallèle (DB
    // partagée prod). On filtre sur le préfixe email_masked qui contient
    // les 2 premiers chars du local-part de l'email (cf. lib/rgpd/mask-email).
    const matching = (auditLogs ?? []).filter((row) => {
      const meta = row.metadata as { email_masked?: string } | null;
      return meta?.email_masked?.startsWith(expectedMaskedPrefix);
    });
    expect(
      matching.length,
      `Aucun audit_log account_login_magic_link trouvé avec prefix ${expectedMaskedPrefix}`,
    ).toBeGreaterThanOrEqual(1);
  });

  test('expired token : auth.admin.generateLink + verify rejected', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    // 1. Crée un user pour générer le lien dessus.
    const user = await createTestUser(ctx, { suffix: 'magic-expired' });

    // 2. Génère un magic-link via auth.admin.generateLink. Ce lien contient
    //    un token_hash + email_otp (selon flow Supabase).
    const admin = getReadOnlyAdminClient();
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    });

    // Si Supabase refuse la génération (config Auth provider désactivée,
    // user état dégradé, etc.), on SKIP gracieusement plutôt que de fail
    // un test sur infra Supabase out-of-scope.
    test.skip(
      !!linkErr || !linkData?.properties?.hashed_token,
      `auth.admin.generateLink a échoué/non configuré : ${linkErr?.message ?? 'no token returned'}. ` +
        `Test skip car pas faisable dans cet env (cf. brief teammate).`,
    );

    // 3. Le hashed_token est valide ~1h par défaut côté Supabase, on ne
    //    peut pas attendre l'expiration en E2E. À la place, on simule un
    //    token invalide en mutilant le hash : modifie le dernier caractère.
    //    Le callback /auth/callback exerce verifyOtp côté Supabase qui
    //    rejette pour token invalide ou expiré → redirect /connexion
    //    avec error=auth_callback + reason=invalid (cf. classifyAuthError
    //    in app/auth/callback/route.ts).
    const validToken = linkData!.properties!.hashed_token!;
    const lastChar = validToken[validToken.length - 1] ?? 'a';
    const flippedChar = lastChar === 'a' ? 'b' : 'a';
    const tamperedToken =
      validToken.slice(0, -1) + flippedChar;

    // 4. Visite /auth/callback avec le token mutilé. Le callback essaie
    //    verifyOtp, échoue, redirige vers /connexion?error=auth_callback&reason=...
    await page.goto(
      `/auth/callback?token_hash=${encodeURIComponent(tamperedToken)}&type=magiclink`,
    );

    // 5. Attend la landing /connexion avec le message FR d'erreur.
    //    Le mapping reason -> message côté connexion/page.tsx couvre
    //    'expired' / 'invalid' / 'missing' / 'technical'. Un token
    //    mutilé tombe en 'invalid' (verifyOtp Supabase retourne
    //    "Token has expired or is invalid").
    await page.waitForURL(/\/connexion(\?|$)/, { timeout: 15_000 });

    // L'UI affiche un alerte contenant le message friendly correspondant.
    await expect(
      page.getByRole('alert').filter({
        hasText: /lien.*(expir|valide|incomplet)/i,
      }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

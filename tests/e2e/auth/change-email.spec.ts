/**
 * E2E change-email tests ADDITIONNELS (Phase 2 cycle e2e exhaustif).
 *
 * Le happy path complet est déjà couvert par tests/e2e/change-email.spec.ts
 * (à la racine tests/e2e/). Ce fichier complète les cas non couverts :
 *
 *   1. wrong OTP : code incorrect step=current → erreur visible avec
 *      attemptsRemaining + retry possible. Audit log account_otp_invalid.
 *   2. attempts cap : 5 échecs successifs → invalidation auto + erreur
 *      "Trop de tentatives". Audit log account_otp_attempts_exceeded.
 *   3. expired OTP : seed un row avec expires_at dans le passé → erreur
 *      "Code expiré". Audit log account_otp_expired.
 *   4. capture email step=current : valide la chaîne RESEND_TEST_MODE pour
 *      le template email-change-otp-current (vérifie le code OTP émis
 *      n'est pas exposé en clair en DB et que le template contient bien
 *      le newEmail comme garde-fou anti-phishing).
 *
 * Tous ces tests utilisent seedOtp pour bypasser le quota Resend des
 * requestOtp côté serveur — sauf le test #4 qui valide explicitement la
 * capture de l'email envoyé par requestOtp.
 */

import { test, expect } from '../helpers/test-context';
import { generateTestEmail } from '../helpers/guards';
import { createTestUser, loginAs } from '../helpers/user-lifecycle';
import {
  seedOtp,
  assertOtpRowExists,
  assertAuditLogContains,
  nowIsoForAudit,
} from '../helpers/otp-capture';
import { waitForCapturedEmail } from '../helpers/mailbox';
import { getReadOnlyAdminClient, safeUpdate } from '../helpers/supabase-admin';

test.describe('Change email — cas additionnels', () => {
  test('wrong OTP : code incorrect → erreur + retry, audit account_otp_invalid', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: 'wrong-otp' });
    await loginAs(page, user);
    await page.goto('/compte/profil');

    // Attendre que le profil soit chargé (le useEffect initial fait un
    // fetch users + getUser → tant qu'il tourne, "Chargement…" est
    // affiché et le bouton "Modifier" n'est pas monté).
    await expect(
      page.getByRole('button', { name: 'Modifier' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Modifier' }).click();

    const newEmail = generateTestEmail('wrong-otp-new');
    await page.getByLabel('Nouvel email').fill(newEmail);
    await page.getByRole('button', { name: 'Envoyer le code' }).click();

    await expect(
      page.getByText(
        /Saisissez le code à 6 chiffres reçu à (ton|votre) adresse actuelle/i,
      ),
    ).toBeVisible();

    // Seed OTP step=current avec code connu = 123456
    await seedOtp(ctx, {
      userId: user.id,
      step: 'current',
      email: user.email,
      code: '123456',
    });

    const t0 = nowIsoForAudit();

    // Tentative avec code FAUX (000000 différent du seed 123456)
    await page.getByLabel('Code à 6 chiffres').fill('000000');
    await page.getByRole('button', { name: 'Valider' }).click();

    // UI doit afficher "Code incorrect. Il te reste X tentative(s)."
    // (cf. ChangeEmailVerifyOtpStep.tsx verifyOtpReasonToMessage:invalid)
    await expect(
      page.getByRole('alert').filter({ hasText: /Code incorrect/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: /tentative/i }),
    ).toBeVisible();

    // Audit log account_otp_invalid émis pour ce user après t0
    await assertAuditLogContains(ctx, {
      userId: user.id,
      eventType: 'account_otp_invalid',
      sinceTimestamp: t0,
      minCount: 1,
    });

    // Le row OTP n'est PAS consommé (consumed_at IS NULL) — l'user peut
    // retry avec le bon code. attempts incrémenté à 1.
    await assertOtpRowExists(ctx, {
      userId: user.id,
      step: 'current',
      consumed: false,
      expectedAttempts: 1,
    });

    // Retry avec le bon code : doit passer en verify-new (chaining auto
    // requestOtp(step=new) côté serveur cf. ChangeEmailSection useEffect).
    await page.getByLabel('Code à 6 chiffres').fill('123456');
    await page.getByRole('button', { name: 'Valider' }).click();

    // Discriminateur step=verify-new : hint contient newEmail (unique au test)
    await expect(page.getByText(newEmail, { exact: false })).toBeVisible();
  });

  test('attempts cap : 5 échecs → invalidation + audit attempts_exceeded', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: 'attempts-cap' });
    await loginAs(page, user);
    await page.goto('/compte/profil');

    await expect(
      page.getByRole('button', { name: 'Modifier' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Modifier' }).click();

    const newEmail = generateTestEmail('attempts-cap-new');
    await page.getByLabel('Nouvel email').fill(newEmail);
    await page.getByRole('button', { name: 'Envoyer le code' }).click();

    await expect(
      page.getByText(
        /Saisissez le code à 6 chiffres reçu à (ton|votre) adresse actuelle/i,
      ),
    ).toBeVisible();

    // Seed OTP avec code connu différent de ce qu'on va saisir
    await seedOtp(ctx, {
      userId: user.id,
      step: 'current',
      email: user.email,
      code: '123456',
    });

    const t0 = nowIsoForAudit();

    // 5 tentatives fausses successives. ATTEMPTS_CAP = 5 (cf. verify-otp.tsx).
    // À la 5ème, le serveur incrémente attempts ET invalide le row + audit
    // log account_otp_attempts_exceeded + reason='attempts_exceeded'.
    const wrongCodes = ['111111', '222222', '333333', '444444', '555555'];
    for (let i = 0; i < wrongCodes.length; i++) {
      await page.getByLabel('Code à 6 chiffres').fill(wrongCodes[i]!);
      await page.getByRole('button', { name: 'Valider' }).click();

      // Attendre que le serveur réponde et que l'erreur soit visible
      // avant de saisir la suivante.
      if (i < wrongCodes.length - 1) {
        await expect(
          page.getByRole('alert').filter({ hasText: /Code incorrect/i }),
        ).toBeVisible();
      }
    }

    // Après la 5ème, message "Trop de tentatives. Demande un nouveau code"
    await expect(
      page.getByRole('alert').filter({ hasText: /Trop de tentatives/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Audit log account_otp_attempts_exceeded émis
    await assertAuditLogContains(ctx, {
      userId: user.id,
      eventType: 'account_otp_attempts_exceeded',
      sinceTimestamp: t0,
      minCount: 1,
    });

    // Row OTP est consumed_at NOT NULL (invalidé par la 5ème tentative)
    await assertOtpRowExists(ctx, {
      userId: user.id,
      step: 'current',
      consumed: true,
    });
  });

  test('expired OTP : row passé → erreur + audit account_otp_expired', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: 'expired-otp' });
    await loginAs(page, user);
    await page.goto('/compte/profil');

    await expect(
      page.getByRole('button', { name: 'Modifier' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Modifier' }).click();

    const newEmail = generateTestEmail('expired-otp-new');
    await page.getByLabel('Nouvel email').fill(newEmail);
    await page.getByRole('button', { name: 'Envoyer le code' }).click();

    await expect(
      page.getByText(
        /Saisissez le code à 6 chiffres reçu à (ton|votre) adresse actuelle/i,
      ),
    ).toBeVisible();

    // Seed un OTP à expires_at = passé (-10 min). Le code seedé est connu
    // mais la row tombera sur la branche expired du verifyOtp.
    const seeded = await seedOtp(ctx, {
      userId: user.id,
      step: 'current',
      email: user.email,
      code: '999999',
      expiresInSeconds: 600,
    });

    // Force expires_at dans le passé via safeUpdate (le seedOtp ne supporte
    // pas directement expiresInSeconds < 0 — la conversion ms est sûre,
    // mais on préfère une mutation explicite pour la clarté).
    await safeUpdate(
      ctx,
      'email_change_otp_codes',
      { expires_at: new Date(Date.now() - 60_000).toISOString() },
      { id: seeded.rowId },
    );

    const t0 = nowIsoForAudit();

    await page.getByLabel('Code à 6 chiffres').fill('999999');
    await page.getByRole('button', { name: 'Valider' }).click();

    // UI affiche "Code expiré. Demande un nouveau code via 'Renvoyer'."
    await expect(
      page.getByRole('alert').filter({ hasText: /Code expiré/i }),
    ).toBeVisible();

    // Audit log account_otp_expired émis
    await assertAuditLogContains(ctx, {
      userId: user.id,
      eventType: 'account_otp_expired',
      sinceTimestamp: t0,
      minCount: 1,
    });
  });

  test('capture email step=current : RESEND_TEST_MODE intercepte + contenu garde-fou', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: 'capture-current' });
    await loginAs(page, user);
    await page.goto('/compte/profil');

    await expect(
      page.getByRole('button', { name: 'Modifier' }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Modifier' }).click();

    const newEmail = generateTestEmail('capture-new-target');
    const requestStartedAt = new Date();

    await page.getByLabel('Nouvel email').fill(newEmail);
    await page.getByRole('button', { name: 'Envoyer le code' }).click();

    // Attendre transition step verify-current : preuve que requestOtp
    // côté serveur a bien fait son INSERT + sendTemplate.
    await expect(
      page.getByText(
        /Saisissez le code à 6 chiffres reçu à (ton|votre) adresse actuelle/i,
      ),
    ).toBeVisible();

    // Capture email envoyé à l'ancienne adresse via RESEND_TEST_MODE
    const captured = await waitForCapturedEmail(ctx, {
      to: user.email,
      template: 'email-change-otp-current',
      since: requestStartedAt,
      timeoutMs: 10_000,
    });

    expect(captured.template).toBe('email-change-otp-current');
    expect(captured.subject).toMatch(/changer ton email/i);
    expect(captured.html, 'html doit être rendu').toBeTruthy();
    // Le template email-change-otp-current affiche le newEmail comme garde-
    // fou anti-phishing (cf. lib/resend/templates/email-change-otp-current.tsx)
    expect(captured.html ?? '').toContain(newEmail);
    // Le code OTP 6 chiffres est visible en clair dans l'email
    expect(captured.html ?? '').toMatch(/\d{6}/);

    // Le hash code en DB n'est PAS le code clair (HMAC)
    const admin = getReadOnlyAdminClient();
    const { data: row } = await admin
      .from('email_change_otp_codes')
      .select('code_hash')
      .eq('user_id', user.id)
      .eq('step', 'current')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(row?.code_hash).toBeTruthy();
    // code_hash est un hex 64 chars (SHA-256), donc != format OTP 6 chiffres
    expect(row?.code_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

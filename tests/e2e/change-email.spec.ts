/**
 * E2E happy path ChangeEmailSection — flow A3 T-013 PR2.
 *
 * Couvre le flow complet 2 OTP successifs in-session :
 *   1. enter-email   → user saisit newEmail, requestOtp(step=current) côté serveur
 *   2. verify-current → seed OTP step=current avec code connu, saisie + Valider
 *   3. verify-new    → chaining auto requestOtp(step=new), seed OTP step=new, saisie + Valider
 *   4. completed     → completeEmailChange auto, écran succès
 *
 * Stratégie de seed : laisser requestOtp côté serveur faire son INSERT
 * (1 mail Resend gaspillé sur mailinator par OTP, négligeable), puis
 * seedOtp DELETE+INSERT pour remplacer la row par une avec un code connu.
 *
 * Timing safety : la transition UI verify-current → verify-new attend
 * strictement le retour serveur de requestOtp(step=new) (cf. useEffect
 * sur requestState dans ChangeEmailSection.tsx), donc seedOtp(step=new)
 * après l'assertion de visibilité du hint discriminant est safe.
 */

import { test, expect } from "./helpers/test-context";
import { generateTestEmail } from "./helpers/guards";
import { createTestUser, loginAs } from "./helpers/user-lifecycle";
import { seedOtp } from "./helpers/otp-capture";
import { getReadOnlyAdminClient } from "./helpers/supabase-admin";

test.describe("Change email (T-013 PR2)", () => {
  test("happy path : flow A3 complet 2 OTP successifs", async ({
    page,
    ctx,
  }) => {
    // 1. Créer user test (email old généré en interne via suffix)
    const user = await createTestUser(ctx, { suffix: "happy-old" });
    const oldEmail = user.email;

    // 2. Login bypass cookie (signInWithPassword + injection localStorage)
    await loginAs(page, user);

    // 3. Goto profil
    await page.goto("/compte/profil");

    // 4. Clic "Modifier" → step idle → enter-email
    await page.getByRole("button", { name: "Modifier" }).click();

    // 5. Saisir newEmail + Envoyer
    const newEmail = generateTestEmail("happy-new");
    await page.getByLabel("Nouvel email").fill(newEmail);
    await page.getByRole("button", { name: "Envoyer le code" }).click();

    // 6. Attendre transition step verify-current.
    //    Le préfixe "Saisissez le code à 6 chiffres reçu" est unique à
    //    VerifyOtpStep — n'apparaît ni dans le header section ni dans le
    //    hint enter-email. Garantit step=verify-current et donc requestOtp
    //    (step=current) terminé côté serveur.
    await expect(
      page.getByText(
        /Saisissez le code à 6 chiffres reçu à votre adresse actuelle/i,
      ),
    ).toBeVisible();

    // 7. Seed OTP step=current avec code connu (DELETE+INSERT)
    const currentCode = "123456";
    await seedOtp(ctx, {
      userId: user.id,
      step: "current",
      email: oldEmail,
      code: currentCode,
    });

    // 8. Saisir code dans UI step verify-current
    await page.getByLabel("Code à 6 chiffres").fill(currentCode);
    await page.getByRole("button", { name: "Valider" }).click();

    // 9. Attendre transition step verify-new.
    //    Discriminateur : le hint contient newEmail (unique au test).
    //    Cette assertion garantit que requestOtp(step=new) chaîné a
    //    terminé son INSERT côté serveur (cf. trace t0→t5).
    await expect(page.getByText(newEmail, { exact: false })).toBeVisible();

    // 10. Seed OTP step=new avec code connu (DELETE+INSERT)
    const newCode = "654321";
    await seedOtp(ctx, {
      userId: user.id,
      step: "new",
      email: newEmail,
      code: newCode,
    });

    // 11. Saisir code dans UI step verify-new
    await page.getByLabel("Code à 6 chiffres").fill(newCode);
    await page.getByRole("button", { name: "Valider" }).click();

    // 12. Attendre écran succès (step completed)
    await expect(
      page.getByText("Email mis à jour avec succès."),
    ).toBeVisible();

    // 13. Assertions DB post-flow
    const admin = getReadOnlyAdminClient();

    // 13a. auth.users.email = newEmail
    const { data: authUser, error: authErr } =
      await admin.auth.admin.getUserById(user.id);
    expect(authErr).toBeNull();
    expect(authUser.user?.email).toBe(newEmail);

    // 13b. public.users.email = newEmail
    const { data: publicUser, error: publicErr } = await admin
      .from("users")
      .select("email")
      .eq("id", user.id)
      .single();
    expect(publicErr).toBeNull();
    expect(publicUser?.email).toBe(newEmail);

    // 13c. email_change_otp_codes : 2 rows (current + new), tous consumed_at NOT NULL
    const { data: otpRows, error: otpErr } = await admin
      .from("email_change_otp_codes")
      .select("step, consumed_at")
      .eq("user_id", user.id);
    expect(otpErr).toBeNull();
    expect(otpRows).toHaveLength(2);
    expect(otpRows?.every((r) => r.consumed_at !== null)).toBe(true);

    // 13d. audit_logs : ≥5 events parmi requested/verified/completed
    const { data: auditLogs, error: auditErr } = await admin
      .from("audit_logs")
      .select("event_type")
      .eq("user_id", user.id)
      .in("event_type", [
        "account_otp_requested",
        "account_otp_verified",
        "account_email_change_completed",
      ]);
    expect(auditErr).toBeNull();
    expect(auditLogs?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});

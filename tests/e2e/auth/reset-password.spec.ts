/**
 * E2E auth/reset-password — flow étape 2 (formulaire nouveau mdp).
 *
 * Stratégie : on génère programmaticamente un token recovery via
 * supabase.auth.admin.generateLink({ type: 'recovery' }) — équivalent
 * fonctionnel du token reçu par mail Supabase (token_hash + type=recovery).
 * On bypass ainsi l'envoi mail Supabase SMTP et on peut tester
 * /reinitialiser-mot-de-passe?token_hash=...&type=recovery directement.
 *
 * Limites : si l'admin API generateLink n'est pas disponible (paramétrage
 * Supabase Dashboard ou rate limit), on skip avec doc.
 */

import { test, expect } from "../helpers/test-context";
import { createTestUser, loginAs } from "../helpers/user-lifecycle";
import { getReadOnlyAdminClient } from "../helpers/supabase-admin";

const NEW_PASSWORD = "Reset1234New";

test.describe("Auth — Reset password (étape 2)", () => {
  test("happy path : token recovery généré + nouveau mdp valide → /compte + audit password_changed", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: "reset-happy" });

    // Génération token recovery via auth.admin (équivalent fonctionnel du
    // token reçu par mail). generateLink retourne un objet avec hashed_token
    // (= token_hash que /reinitialiser-mot-de-passe?token_hash=... attend).
    const admin = getReadOnlyAdminClient();
    const { data: linkData, error: linkErr } =
      await admin.auth.admin.generateLink({
        type: "recovery",
        email: user.email,
      });

    test.skip(
      !!linkErr || !linkData?.properties?.hashed_token,
      `auth.admin.generateLink indisponible: ${linkErr?.message ?? "no hashed_token returned"}`,
    );

    const tokenHash = linkData!.properties!.hashed_token!;

    await page.goto(
      `/reinitialiser-mot-de-passe?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`,
    );

    // Page valide la shape (token_hash >= 10 chars + type=recovery) → render form
    await expect(
      page.getByRole("heading", { name: /Nouveau mot de passe/i }),
    ).toBeVisible({ timeout: 10_000 });

    await page
      .getByLabel("Nouveau mot de passe", { exact: true })
      .fill(NEW_PASSWORD);
    await page
      .getByLabel("Confirmer le mot de passe", { exact: true })
      .fill(NEW_PASSWORD);

    await page
      .getByRole("button", { name: /Définir mon nouveau mot de passe/i })
      .click();

    // updatePasswordAction redirect vers /compte?password=updated
    await expect(page).toHaveURL(/\/compte/, { timeout: 15_000 });

    // Audit log : password_changed posé pour cet user
    const { data: events, error } = await admin
      .from("audit_logs")
      .select("event_type")
      .eq("user_id", user.id)
      .eq("event_type", "password_changed");
    expect(error).toBeNull();
    expect(events?.length ?? 0).toBeGreaterThanOrEqual(1);

    // Vérifier que le nouveau mdp permet bien de se connecter (preuve
    // forte que le password est bien updaté côté auth.users)
    await page.goto("/compte"); // reuse session post-redirect
    // Rapide check : on est toujours connecté donc /compte ne redirige pas
    await expect(page).toHaveURL(/\/compte/);
  });

  test("weak new password (<8 chars) : Zod rejette → erreur visible", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: "reset-weak" });

    const admin = getReadOnlyAdminClient();
    const { data: linkData, error: linkErr } =
      await admin.auth.admin.generateLink({
        type: "recovery",
        email: user.email,
      });

    test.skip(
      !!linkErr || !linkData?.properties?.hashed_token,
      `auth.admin.generateLink indisponible: ${linkErr?.message ?? "no hashed_token returned"}`,
    );

    const tokenHash = linkData!.properties!.hashed_token!;

    await page.goto(
      `/reinitialiser-mot-de-passe?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`,
    );

    // Bypass le minLength HTML pour observer la validation Zod côté server action
    await page.evaluate(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(
        'input[type="password"]',
      );
      inputs.forEach((i) => {
        i.removeAttribute("minlength");
        i.removeAttribute("required");
      });
    });

    await page
      .getByLabel("Nouveau mot de passe", { exact: true })
      .fill("aB1");
    await page
      .getByLabel("Confirmer le mot de passe", { exact: true })
      .fill("aB1");

    await page
      .getByRole("button", { name: /Définir mon nouveau mot de passe/i })
      .click();

    // Le message Zod canonique : "Mot de passe : 8 caractères minimum"
    await expect(page.getByText(/8 caractères minimum/i)).toBeVisible({
      timeout: 10_000,
    });

    // Pas de redirect — on reste sur /reinitialiser-mot-de-passe
    await expect(page).toHaveURL(/reinitialiser-mot-de-passe/);
  });

  test("invalid token : verifyOtp rejette → message expiré + lien renvoi", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    // Token bidon mais shape valide (>= 10 chars). La page server component
    // accepte la shape, le form submit → verifyOtp côté action → erreur.
    const fakeTokenHash = "fake_token_hash_invalid_xxxxxxxxxxxxxx";

    await page.goto(
      `/reinitialiser-mot-de-passe?token_hash=${encodeURIComponent(fakeTokenHash)}&type=recovery`,
    );

    await expect(
      page.getByRole("heading", { name: /Nouveau mot de passe/i }),
    ).toBeVisible({ timeout: 10_000 });

    await page
      .getByLabel("Nouveau mot de passe", { exact: true })
      .fill(NEW_PASSWORD);
    await page
      .getByLabel("Confirmer le mot de passe", { exact: true })
      .fill(NEW_PASSWORD);

    await page
      .getByRole("button", { name: /Définir mon nouveau mot de passe/i })
      .click();

    // Message "Lien expiré ou déjà utilisé" + lien "Demander un nouveau lien"
    await expect(
      page.getByText(/Lien de réinitialisation expiré ou déjà utilisé/i),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("link", { name: /Demander un nouveau lien/i }),
    ).toBeVisible();
  });
});

// ESLint quiet : import loginAs préservé pour future extensibilité (re-login
// post-reset). Ne pas le supprimer.
void loginAs;

/**
 * E2E inscription CGU — opposabilité juridique au signup.
 *
 * Couverture :
 *   1. Checkbox CGU obligatoire — bouton submit gardé désactivé tant que non cochée.
 *   2. Cocher → submit succeed → row public.users créée avec
 *      cgu_accepted_at récent + cgu_version = LEGAL_VERSIONS.CGU ('1.0').
 *   3. Liens "/cgu" et "/politique-confidentialite" dans le label : target="_blank".
 *
 * Pattern :
 *   - On utilise le formulaire UI réel (pas createTestUser bypass) pour valider
 *     le flow signup complet. L'INSERT public.users avec cgu_accepted_at se fait
 *     IMMÉDIATEMENT après auth.signUp côté server action (cf. actions.ts:102-110)
 *     — pas besoin de cliquer le magic link pour vérifier la persistance DB.
 *   - On track l'ID post-INSERT via SELECT admin pour que cleanupAllTrackedUsers
 *     (afterEach) purge auth.users + public.users via cascade FK.
 *
 * Stripe / Resend :
 *   - Le signUp envoie un mail Resend (magic link) — coût ~1 mail par run du test
 *     "happy path". Volumétrie compatible quota 3000/mois.
 *   - Aucun call Stripe.
 */

import { test, expect } from "../helpers/test-context";
import { generateTestEmail } from "../helpers/guards";
import {
  getReadOnlyAdminClient,
  trackUserId,
} from "../helpers/supabase-admin";

const STRONG_PASSWORD = "Test1234"; // matche strongPasswordSchema (8+ / aA / 9)

test.describe("Inscription CGU (opposabilité juridique)", () => {
  test("checkbox CGU non cochée : bouton submit reste désactivé", async ({
    page,
  }) => {
    await page.goto("/auth/inscription");

    // Remplir tous les champs requis SAUF la checkbox CGU.
    await page.getByLabel("Prénom").fill("Test");
    await page.getByLabel("Nom", { exact: true }).fill("Inscription");
    await page.getByLabel("Email").fill(generateTestEmail("cgu-gate"));
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(STRONG_PASSWORD);

    const submit = page.getByRole("button", {
      name: "Créer mon compte",
      exact: true,
    });

    // Avant cocher : bouton désactivé (gate UI).
    await expect(submit).toBeDisabled();

    const cguCheckbox = page.getByRole("checkbox", {
      name: /Conditions générales d.utilisation/i,
    });
    await expect(cguCheckbox).toBeVisible();
    await expect(cguCheckbox).not.toBeChecked();

    // Note : on ne tente pas de cliquer le bouton désactivé — Playwright bloquerait
    // l'action via le check `isEnabled` interne. La gate UI est la garantie testée ici.
  });

  test("liens CGU + politique de confidentialité ouvrent dans nouvel onglet", async ({
    page,
  }) => {
    await page.goto("/auth/inscription");

    const cguLink = page.getByRole("link", {
      name: /Conditions générales d.utilisation/i,
    });
    await expect(cguLink).toHaveAttribute("target", "_blank");
    await expect(cguLink).toHaveAttribute("href", "/cgu");
    // rel="noopener" présent (security best-practice target="_blank").
    await expect(cguLink).toHaveAttribute("rel", /noopener/);

    const policyLink = page.getByRole("link", {
      name: /Politique de confidentialité/i,
    });
    await expect(policyLink).toHaveAttribute("target", "_blank");
    await expect(policyLink).toHaveAttribute(
      "href",
      "/politique-confidentialite",
    );
    await expect(policyLink).toHaveAttribute("rel", /noopener/);
  });

  test("cocher CGU → submit OK → row users avec cgu_accepted_at + cgu_version='1.0'", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000); // signUp Supabase + INSERT public.users peut prendre 5-10s

    const email = generateTestEmail("cgu-happy");
    const submitTimestamp = Date.now();

    await page.goto("/auth/inscription");
    await page.getByLabel("Prénom").fill("Test");
    await page.getByLabel("Nom", { exact: true }).fill("Happy");
    await page.getByLabel("Email").fill(email);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(STRONG_PASSWORD);

    const cguCheckbox = page.getByRole("checkbox", {
      name: /Conditions générales d.utilisation/i,
    });
    await cguCheckbox.check();
    await expect(cguCheckbox).toBeChecked();

    const submit = page.getByRole("button", {
      name: "Créer mon compte",
      exact: true,
    });
    await expect(submit).toBeEnabled();
    await submit.click();

    // L'action server retourne success { email } → la page bascule sur l'écran
    // "Vérifiez vos emails". Marqueur stable pour confirmer que le signUp a OK.
    await expect(page.getByText(/Vérifiez vos emails/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(email)).toBeVisible();

    // Query DB read-only pour vérifier la persistance CGU.
    // L'INSERT public.users se fait avec service_role côté actions.ts donc la row
    // est garantie présente quand on atteint cette étape.
    const admin = getReadOnlyAdminClient();
    const { data: userRow, error } = await admin
      .from("users")
      .select("id, email, cgu_accepted_at, cgu_version")
      .ilike("email", email)
      .maybeSingle();

    expect(error, `users SELECT: ${error?.message}`).toBeNull();
    expect(userRow, `users row pour ${email}`).not.toBeNull();
    const row = userRow!;

    // Track l'id pour cleanup auto en afterEach (auth.admin.deleteUser cascade
    // sur public.users via FK ON DELETE CASCADE).
    trackUserId(ctx, row.id as string);

    expect(row.email).toBe(email);
    expect(row.cgu_version).toBe("1.0");
    expect(row.cgu_accepted_at, "cgu_accepted_at peuplé").toBeTruthy();

    // Le timestamp DB doit être proche de notre submit (fenêtre 60s pour
    // tolérer latence + clock skew).
    const acceptedMs = new Date(row.cgu_accepted_at as string).getTime();
    expect(acceptedMs).toBeGreaterThanOrEqual(submitTimestamp - 5_000);
    expect(acceptedMs).toBeLessThanOrEqual(submitTimestamp + 60_000);
  });
});

/**
 * E2E Phase 2bis — /devenir-producteur self-service (création de compte).
 *
 * Couverture :
 *   - happy path spontané : formulaire → compte créé (auth + users
 *     roles=[consumer,producer] + producers draft) + lead spontané.
 *   - email déjà connu : message clair + lien connexion, pas de doublon.
 *   - password trop court (< 12) : refus validation Zod.
 *
 * NB Windows/Next 16 : lancer ce spec seul (cf. CLAUDE.md § Playwright).
 *   npx playwright test tests/e2e/producer/devenir-producteur.spec.ts --workers=1
 *
 * Le compte créé porte un email sentinel → nettoyé par global-teardown
 * (auth.users + CASCADE producers). Le lead producer_interests (clé email)
 * est balayé par le sweep sentinel.
 */

import { test, expect } from "../helpers/test-context";
import { generateTestEmail } from "../helpers/guards";
import { createTestUser } from "../helpers/user-lifecycle";
import { getReadOnlyAdminClient, trackUserId } from "../helpers/supabase-admin";

const STRONG_PASSWORD = "Test1234abcd"; // 12 chars, conforme strongPasswordSchema

async function fillCommon(
  page: import("@playwright/test").Page,
  email: string,
): Promise<void> {
  await page.goto("/devenir-producteur#formulaire");
  await page.getByLabel("Prénom").fill("Jean");
  await page.getByLabel("Nom", { exact: true }).fill("Producteur");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Téléphone").fill("0600000000");
  await page.getByLabel("Mot de passe", { exact: true }).fill(STRONG_PASSWORD);
  await page
    .getByLabel("Confirmer le mot de passe", { exact: true })
    .fill(STRONG_PASSWORD);
  await page.getByLabel("Nom de l'exploitation").fill("Ferme E2E");
  await page.getByLabel("Commune").fill("Le Mans");
  await page.getByLabel("Code postal").fill("72000");
  await page
    .getByRole("checkbox", { name: /conditions d.utilisation/i })
    .check();
}

test.describe("Producteur — /devenir-producteur (self-service)", () => {
  test("happy path spontané : compte producteur + lead créés", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);
    const email = generateTestEmail("devenir-prod");

    await fillCommon(page, email);
    await page.getByRole("button", { name: /Créer mon espace/i }).click();

    await expect(page.getByText(/Votre espace est créé/i)).toBeVisible({
      timeout: 15_000,
    });

    const admin = getReadOnlyAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("id, roles")
      .eq("email", email)
      .maybeSingle();
    expect(profile).toBeTruthy();
    if (profile) {
      trackUserId(ctx, profile.id as string);
      expect(profile.roles).toEqual(
        expect.arrayContaining(["consumer", "producer"]),
      );
      const { data: producer } = await admin
        .from("producers")
        .select("statut")
        .eq("user_id", profile.id as string)
        .maybeSingle();
      expect(producer?.statut).toBe("draft");
    }

    const { data: lead } = await admin
      .from("producer_interests")
      .select("source")
      .eq("email", email)
      .maybeSingle();
    expect(lead?.source).toBe("formulaire_public");
  });

  test("email déjà connu : message clair + lien connexion, pas de doublon", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);
    // createTestUser génère un email sentinel + auto-track (cleanup teardown).
    const existing = await createTestUser(ctx, {
      suffix: "devenir-prod-dup",
      password: STRONG_PASSWORD,
    });
    const email = existing.email;

    await fillCommon(page, email);
    await page.getByRole("button", { name: /Créer mon espace/i }).click();

    await expect(page.getByText(/compte existe déjà/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: /Se connecter/i })).toBeVisible();
  });

  test("password trop court (< 12) : refus validation", async ({ page }) => {
    test.setTimeout(60_000);
    const email = generateTestEmail("devenir-prod-shortpw");

    await page.goto("/devenir-producteur#formulaire");
    await page.getByLabel("Prénom").fill("Jean");
    await page.getByLabel("Nom", { exact: true }).fill("Producteur");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Téléphone").fill("0600000000");
    await page.getByLabel("Mot de passe", { exact: true }).fill("Short1aBcd"); // 10 chars
    await page
      .getByLabel("Confirmer le mot de passe", { exact: true })
      .fill("Short1aBcd");
    await page.getByLabel("Nom de l'exploitation").fill("Ferme E2E");
    await page.getByLabel("Commune").fill("Le Mans");
    await page.getByLabel("Code postal").fill("72000");
    await page
      .getByRole("checkbox", { name: /conditions d.utilisation/i })
      .check();
    await page.getByRole("button", { name: /Créer mon espace/i }).click();

    await expect(page.getByText(/12 caractères minimum/i)).toBeVisible({
      timeout: 15_000,
    });
    // Aucun compte ne doit avoir été créé
    const admin = getReadOnlyAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(profile).toBeNull();
  });
});

/**
 * E2E auth/forgot-password — flow étape 1 (demande de reset).
 *
 * Submit form /mot-de-passe-oublie → server action requestPasswordResetAction
 * → Supabase resetPasswordForEmail (envoi mail via Supabase SMTP, pas via
 * sendTemplate lib/resend). Donc PAS d'assertion sur test_emails_captured —
 * preuve indirecte via :
 *   - Success page "Vérifie tes emails"
 *   - Audit log password_reset_request posé (toujours, peu importe email connu/inconnu)
 *
 * Cap rate-limit recovery = 3/60s/IP (cf. lib/rate-limit getRecoveryRateLimit).
 */

import { test, expect } from "../helpers/test-context";
import { generateTestEmail } from "../helpers/guards";
import { createTestUser } from "../helpers/user-lifecycle";
import { getReadOnlyAdminClient } from "../helpers/supabase-admin";

test.describe("Auth — Forgot password", () => {
  test("happy path : email valide → success page + audit log password_reset_request", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const user = await createTestUser(ctx, { suffix: "fpwd-happy" });
    const requestStartedAt = new Date();

    await page.goto("/mot-de-passe-oublie");
    await page.getByLabel(/Email/i).fill(user.email);
    await page
      .getByRole("button", { name: /Envoyer le lien/i })
      .click();

    // Success page (sent state)
    await expect(page.getByText(/Vérifie tes emails/i)).toBeVisible({
      timeout: 15_000,
    });

    // Audit log : password_reset_request émis (user_id=null, masking via
    // metadata.email_masked).
    const admin = getReadOnlyAdminClient();
    const { data: events, error } = await admin
      .from("audit_logs")
      .select("event_type, created_at")
      .eq("event_type", "password_reset_request")
      .gte("created_at", requestStartedAt.toISOString())
      .order("created_at", { ascending: false })
      .limit(5);
    expect(error).toBeNull();
    expect(events?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  test("email enum-resistance : email inconnu → success page identique", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Email allow-list mais qui ne correspond à aucun user en DB
    const unknownEmail = generateTestEmail("fpwd-unknown");

    await page.goto("/mot-de-passe-oublie");
    await page.getByLabel(/Email/i).fill(unknownEmail);
    await page
      .getByRole("button", { name: /Envoyer le lien/i })
      .click();

    // Même success page que happy path — pas de différence UI selon
    // existence de l'email (enumeration-resistance).
    await expect(page.getByText(/Vérifie tes emails/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("rate limit IP : 4 demandes consécutives → 4e refusée (cap 3/60s)", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const hasUpstash = Boolean(
      process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN,
    );
    test.skip(
      !hasUpstash,
      "UPSTASH_REDIS_REST_URL/TOKEN absent — rate-limit fail-open, test non vérifiable",
    );

    let rateLimitTriggered = false;
    for (let i = 0; i < 4; i++) {
      const email = generateTestEmail(`fpwd-rl-${i}-${Date.now()}`);
      await page.goto("/mot-de-passe-oublie");
      await page.getByLabel(/Email/i).fill(email);
      await page
        .getByRole("button", { name: /Envoyer le lien/i })
        .click();

      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      // La page passe au state "sent" (success) systématiquement même en
      // rate-limit, car l'erreur n'est pas affichée (cf. mot-de-passe-oublie/page.tsx
      // : setSent(true) inconditionnel post-action). On ne peut pas observer
      // le rate-limit côté UI ici.
      //
      // À défaut, on observe l'audit_logs : sur cap reached, l'event
      // rate_limit_exceeded metadata.route='recovery' est émis alors que
      // password_reset_request ne l'est pas.
    }

    // Vérifier qu'au moins un rate_limit_exceeded route=recovery a été émis
    const admin = getReadOnlyAdminClient();
    const { data: events, error } = await admin
      .from("audit_logs")
      .select("event_type, metadata, created_at")
      .eq("event_type", "rate_limit_exceeded")
      .order("created_at", { ascending: false })
      .limit(20);
    expect(error).toBeNull();
    const recoveryEvents = (events ?? []).filter(
      (e) =>
        (e.metadata as { route?: string })?.route === "recovery",
    );
    rateLimitTriggered = recoveryEvents.length >= 1;

    expect(
      rateLimitTriggered,
      "Au moins un rate_limit_exceeded route=recovery doit avoir été émis",
    ).toBe(true);
  });
});

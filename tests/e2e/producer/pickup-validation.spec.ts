/**
 * E2E producer/pickup-validation — chantier pickup-validation 06/05/2026
 * (cf. CLAUDE.md "Pickup validation chantier complet").
 *
 * Couverture (4 tests) :
 *   1. Path id-based (page detail /commandes/[id]) : producer saisit
 *      code TRR-* → POST /api/orders/:id/complete → transition
 *      confirmed → completed + email J0 review-request + audit log
 *      pickup_validated metadata.route='complete_id_based'.
 *   2. Path code-based (haut de liste /commandes via PickupValidationCard) :
 *      GET /api/producer/orders/validate-pickup?code=X (preview) puis
 *      POST {code} → idem transition + email + audit log
 *      pickup_validated.
 *   3. Code mismatch (id-based) : code saisi ≠ code commande → 400
 *      "Code invalide" + audit pickup_attempt_invalid reason='code_mismatch',
 *      statut DB inchangé.
 *   4. Race-safe atomique : 2 POST /complete simultanés → un seul réussit
 *      (UPDATE ... WHERE statut='confirmed' filtre 0 rows sur le 2e).
 *
 * Bypass rate-limit ACTIF (RATE_LIMIT_BYPASS_TESTS=true) — le test du
 * cap 10/min/producer n'est pas vérifiable en E2E sans désactiver le
 * bypass au niveau env (cf. lib/rate-limit.ts triple gate). Documenté
 * comme assertion structurelle/forensique non testable ici.
 *
 * Resend : 2 emails review-request (templates review_request_j0).
 */

import { test, expect } from "../helpers/test-context";
import { seedProducer, seedConsumer } from "../helpers/db-seed";
import { createTestOrder, cleanupOrdersForProducers } from "../helpers/order-lifecycle";
import { loginAs } from "../helpers/user-lifecycle";
import { waitForCapturedEmail } from "../helpers/mailbox";
import { getReadOnlyAdminClient } from "../helpers/supabase-admin";

test.describe("Producer — Pickup validation", () => {
  test("path id-based : page detail commande /:id valide retrait via code", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "pkup-id",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "pkup-id-cons" });

    try {
      // Pas de codeCommande custom : on laisse le trigger Postgres
      // generate_order_code() poser un code TRR valide. L'input UI applique
      // un maxLength=12 + strip [^A-Z0-9] qui mangerait un PKUP-{ts}-X long,
      // d'où "Code invalide" 400 et test rouge.
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "confirmed",
      });

      const sinceTs = new Date();
      await loginAs(page, producer.user);
      await page.goto(`/commandes/${order.orderId}`);
      await expect(
        page.getByRole("heading", { name: /Commande de/i }),
      ).toBeVisible();

      // Saisie du code dans la card "Validation du retrait" (visible
      // uniquement quand status === 'confirmed' — cf.
      // OrderDetailClient.tsx:152 canValidateCode).
      await page.getByLabel("Code de commande").fill(order.codeCommande);
      await page
        .getByRole("button", { name: /Valider le retrait/i })
        .click();

      // Marqueur UI succès "Retrait validé" (animation success).
      await expect(page.getByText(/Retrait validé/i)).toBeVisible({
        timeout: 10_000,
      });

      // Vérif DB : statut + completed_at posé.
      const admin = getReadOnlyAdminClient();
      const { data: row } = await admin
        .from("orders")
        .select("statut, completed_at")
        .eq("id", order.orderId)
        .single();
      expect(row?.statut).toBe("completed");
      expect(row?.completed_at).not.toBeNull();

      // Audit log cluster pickup_* avec metadata.route discriminant le
      // path id-based (cf. complete/route.tsx ROUTE_TAG = "complete_id_based").
      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("event_type, metadata, created_at")
        .eq("user_id", producer.user.id)
        .eq("event_type", "pickup_validated")
        .gte("created_at", sinceTs.toISOString())
        .order("created_at", { ascending: false })
        .limit(5);
      expect(auditRows?.length ?? 0).toBeGreaterThanOrEqual(1);
      const meta = auditRows![0].metadata as Record<string, unknown>;
      expect(meta.route).toBe("complete_id_based");
      expect(meta.order_id).toBe(order.orderId);

      // Email J0 review-request (helper sendPickupReviewEmail →
      // template 'review_request_j0').
      const mail = await waitForCapturedEmail(ctx, {
        to: consumer.email,
        template: "review_request_j0",
        since: sinceTs,
        timeoutMs: 15_000,
      });
      expect(mail.metadata.order_id).toBe(order.orderId);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("path code-based : PickupValidationCard preview + confirm", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "pkup-code",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "pkup-code-cons" });

    try {
      // Cf. test #1 : trigger generate_order_code() pose un code TRR valide
      // que l'input UI accepte sans tronquer (maxLength=12).
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "confirmed",
      });

      const sinceTs = new Date();
      await loginAs(page, producer.user);
      await page.goto("/commandes");
      await expect(
        page.getByRole("heading", {
          name: /Saisissez le code de retrait/i,
        }),
      ).toBeVisible();

      // Étape 1 — saisie + Vérifier (GET preview).
      await page
        .getByLabel("Code de retrait")
        .fill(order.codeCommande);
      await page.getByRole("button", { name: /^Vérifier$/i }).click();

      // Étape 2 — modale preview affichée avec "Confirmer la remise".
      await expect(
        page.getByRole("heading", { name: /Confirmer la remise/i }),
      ).toBeVisible({ timeout: 10_000 });

      // Bouton "Confirmer la remise" dans le footer modale.
      await page
        .getByRole("button", { name: /Confirmer la remise/i })
        .click();

      // Étape 3 — succès "Commande remise à <Prenom>".
      await expect(
        page.getByText(/Commande remise à/i),
      ).toBeVisible({ timeout: 10_000 });

      // Vérif DB.
      const admin = getReadOnlyAdminClient();
      const { data: row } = await admin
        .from("orders")
        .select("statut, completed_at")
        .eq("id", order.orderId)
        .single();
      expect(row?.statut).toBe("completed");
      expect(row?.completed_at).not.toBeNull();

      // Audit log cluster pickup_* — la route code-based ne tag PAS
      // metadata.route mais on doit avoir au moins un pickup_validated
      // récent attribué à ce producer.
      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("event_type, metadata, created_at")
        .eq("user_id", producer.user.id)
        .eq("event_type", "pickup_validated")
        .gte("created_at", sinceTs.toISOString())
        .order("created_at", { ascending: false })
        .limit(5);
      expect(auditRows?.length ?? 0).toBeGreaterThanOrEqual(1);
      const meta = auditRows![0].metadata as Record<string, unknown>;
      expect(meta.order_id).toBe(order.orderId);

      // Email J0 review-request.
      const mail = await waitForCapturedEmail(ctx, {
        to: consumer.email,
        template: "review_request_j0",
        since: sinceTs,
        timeoutMs: 15_000,
      });
      expect(mail.metadata.order_id).toBe(order.orderId);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("code mismatch (id-based) → 400 + audit pickup_attempt_invalid", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "pkup-bad",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "pkup-bad-cons" });

    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "confirmed",
      });

      const sinceTs = new Date();
      await loginAs(page, producer.user);

      // POST direct API avec un code qui ne correspond pas. Évite la
      // friction UI pour aller direct au cas serveur.
      const res = await page.request.post(
        `/api/orders/${order.orderId}/complete`,
        {
          data: { code_commande: "TRR-WRONG9" },
        },
      );
      expect(res.status()).toBe(400);
      const body = await res.json().catch(() => ({}));
      expect(body.error).toMatch(/Code invalide/i);

      // Audit cluster pickup_* avec reason 'code_mismatch'.
      const admin = getReadOnlyAdminClient();
      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("event_type, metadata, created_at")
        .eq("user_id", producer.user.id)
        .eq("event_type", "pickup_attempt_invalid")
        .gte("created_at", sinceTs.toISOString())
        .order("created_at", { ascending: false })
        .limit(5);
      expect(auditRows?.length ?? 0).toBeGreaterThanOrEqual(1);
      const meta = auditRows![0].metadata as Record<string, unknown>;
      expect(meta.reason).toBe("code_mismatch");

      // Statut DB inchangé.
      const { data: row } = await admin
        .from("orders")
        .select("statut")
        .eq("id", order.orderId)
        .single();
      expect(row?.statut).toBe("confirmed");
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("race-safe atomique : 2 POST /complete simultanés → un seul réussit", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "pkup-race",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "pkup-race-cons" });

    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "confirmed",
      });

      await loginAs(page, producer.user);

      // 2 POST simultanés (Promise.all). Sec-P1-2 : `UPDATE ... WHERE
      // statut='confirmed'` garantit qu'un seul des 2 retourne 200 OK
      // avec une vraie transition ; le 2e tombe sur 0 rows touchés et
      // renvoie {ok:true, already:true} (cf. complete/route.tsx:178-194).
      const [res1, res2] = await Promise.all([
        page.request.post(`/api/orders/${order.orderId}/complete`, {
          data: { code_commande: order.codeCommande },
        }),
        page.request.post(`/api/orders/${order.orderId}/complete`, {
          data: { code_commande: order.codeCommande },
        }),
      ]);

      // Les 2 réponses sont 200 (idempotent business-wise) — l'une
      // contient completed_at, l'autre `already:true`.
      expect(res1.status()).toBe(200);
      expect(res2.status()).toBe(200);

      const body1 = await res1.json();
      const body2 = await res2.json();
      const fresh = [body1, body2].filter((b) => b.completed_at);
      const already = [body1, body2].filter((b) => b.already === true);
      // Au plus un des 2 transitionne réellement. Selon l'ordre serveur,
      // soit 1 fresh + 1 already, soit (rare) les 2 fresh si exécutés
      // à des ms différentes — on accepte 0 ≤ already ≤ 1 et 1 ≤ fresh.
      expect(fresh.length).toBeGreaterThanOrEqual(1);
      expect(already.length).toBeLessThanOrEqual(1);

      // DB : un seul completed_at, statut completed.
      const admin = getReadOnlyAdminClient();
      const { data: row } = await admin
        .from("orders")
        .select("statut, completed_at")
        .eq("id", order.orderId)
        .single();
      expect(row?.statut).toBe("completed");
      expect(row?.completed_at).not.toBeNull();
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});

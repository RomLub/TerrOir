/**
 * E2E producer response (CGU 6.4) — droit de réponse Producer aux avis.
 *
 * Couverture :
 *   1. Producer répond à un avis publié → DB peuplée (producer_response,
 *      producer_response_at, producer_response_locked_at, status='published').
 *   2. Modification dans la fenêtre 24h → producer_response_updated_at posé,
 *      producer_response_at unchanged (lock unchanged).
 *   3. Suppression dans la fenêtre 24h → producer_response NULL,
 *      producer_response_status='removed_producer'.
 *
 * Cleanup ordre (FK respect) :
 *   - reviews (FK order_id, producer_id, consumer_id) : DELETE manuel via
 *     safeDelete tracké par testId, sinon producers DELETE bloqué (NO ACTION).
 *   - orders/order_items : cleanupOrdersForProducers (cf. RLS isolation spec).
 *   - producers/users : cleanupAllTrackedUsers en afterEach (cascade FK).
 *
 * Stripe / Resend : pas d'envoi Stripe. L'email Resend (notification
 * consumer) est trigger par POST /respond mais loggé skipped si la pref est
 * désactivée. Ici on laisse le default true → 1 email réel par run de test
 * happy-path (~3 mails total). Compatible quota 3000/mois.
 */

import { test, expect } from "../helpers/test-context";
import { createTestProducer } from "../helpers/producer-lifecycle";
import { createTestUser, loginAs } from "../helpers/user-lifecycle";
import {
  createTestOrder,
  cleanupOrdersForProducers,
} from "../helpers/order-lifecycle";
import {
  getReadOnlyAdminClient,
  safeDelete,
  trackRowId,
  type TestContext,
} from "../helpers/supabase-admin";

async function insertPublishedReview(
  ctx: TestContext,
  args: { producerId: string; consumerId: string; orderId: string },
): Promise<string> {
  const admin = getReadOnlyAdminClient();
  // Note : insertion via raw admin (pas safeInsert) pour pouvoir tracker
  // l'id retourné — pattern aligné avec les autres helpers lifecycle.
  const { data, error } = await admin
    .from("reviews")
    .insert({
      order_id: args.orderId,
      producer_id: args.producerId,
      consumer_id: args.consumerId,
      note: 5,
      commentaire: "Excellent produit, livraison parfaite.",
      statut: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertPublishedReview failed: ${error?.message}`);
  }
  trackRowId(ctx, data.id as string);
  return data.id as string;
}

async function cleanupReview(ctx: TestContext, reviewId: string) {
  await safeDelete(ctx, "reviews", { id: reviewId }).catch((err) => {
    console.warn(`[cleanup] reviews failed for ${reviewId}:`, err);
  });
}

async function openFirstReview(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Ouvrir", exact: true }).first().click();
  await expect(page.getByText(/Répondre à cet avis/i)).toBeVisible();
}

test.describe("Producer response (CGU 6.4)", () => {
  test("producer répond à un avis → DB peuplée + audit log + lock 24h", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await createTestProducer(ctx, {
      suffix: "resp-pub",
      statut: "public",
    });
    const consumer = await createTestUser(ctx, { suffix: "resp-cons" });

    let reviewId: string | null = null;
    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "completed",
      });
      reviewId = await insertPublishedReview(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        orderId: order.orderId,
      });

      // Login producer + navigation /avis.
      const submitTs = Date.now();
      await loginAs(page, producer.user);
      await page.goto("/mes-avis");
      await expect(
        page.getByRole("heading", { name: "Mes avis", exact: true }),
      ).toBeVisible();
      await openFirstReview(page);

      // Compose la réponse.
      const responseText =
        "Merci pour votre retour, à très vite à la ferme !";
      await page.getByPlaceholder(/Votre réponse publique/i).fill(responseText);
      await page
        .getByRole("button", { name: /Publier la réponse/i })
        .click();

      // Marqueur UI post-publish : la réponse apparaît dans la card.
      await expect(page.getByText(responseText)).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/Votre réponse/i).first()).toBeVisible();

      // Vérification DB.
      const admin = getReadOnlyAdminClient();
      const { data: row, error } = await admin
        .from("reviews")
        .select(
          "producer_response, producer_response_at, producer_response_locked_at, producer_response_status, producer_response_updated_at",
        )
        .eq("id", reviewId)
        .single();
      expect(error, `reviews SELECT: ${error?.message}`).toBeNull();
      expect(row).not.toBeNull();
      const r = row!;

      expect(r.producer_response).toBe(responseText);
      expect(r.producer_response_status).toBe("published");
      expect(r.producer_response_updated_at).toBeNull();

      const respAt = new Date(r.producer_response_at as string).getTime();
      expect(respAt).toBeGreaterThanOrEqual(submitTs - 5_000);
      expect(respAt).toBeLessThanOrEqual(submitTs + 60_000);

      const lockAt = new Date(r.producer_response_locked_at as string).getTime();
      // Lock ~24h plus tard.
      expect(lockAt - respAt).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(lockAt - respAt).toBeLessThan(25 * 60 * 60 * 1000);

      // Audit log producer_response_published émis.
      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("event_type, metadata")
        .eq("user_id", producer.user.id)
        .eq("event_type", "producer_response_published")
        .order("created_at", { ascending: false })
        .limit(1);
      expect(auditRows).toHaveLength(1);
      expect(
        (auditRows![0].metadata as Record<string, unknown>).review_id,
      ).toBe(reviewId);
    } finally {
      if (reviewId) await cleanupReview(ctx, reviewId);
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("modification dans 24h → updated_at posé, locked_at unchanged", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await createTestProducer(ctx, {
      suffix: "resp-edit",
      statut: "public",
    });
    const consumer = await createTestUser(ctx, { suffix: "resp-edit-cons" });

    let reviewId: string | null = null;
    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "completed",
      });
      reviewId = await insertPublishedReview(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        orderId: order.orderId,
      });

      await loginAs(page, producer.user);
      await page.goto("/mes-avis");
      await openFirstReview(page);

      // Première publication. Marqueur fiable : retour mode display avec
      // bouton Modifier visible (évite la race textarea content).
      await page.getByPlaceholder(/Votre réponse publique/i).fill("Première version");
      await page.getByRole("button", { name: /Publier la réponse/i }).click();
      await expect(
        page.getByRole("button", { name: "Modifier", exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      // Snapshot DB v1 (pour comparer respAt après update).
      const admin = getReadOnlyAdminClient();
      const { data: v1 } = await admin
        .from("reviews")
        .select("producer_response_at, producer_response_locked_at")
        .eq("id", reviewId)
        .single();
      const v1RespAt = v1!.producer_response_at as string;
      const v1LockAt = v1!.producer_response_locked_at as string;

      // Édition.
      await page.getByRole("button", { name: "Modifier", exact: true }).click();
      const textarea = page.getByPlaceholder(/Votre réponse publique/i);
      await textarea.fill("Version modifiée");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      // Marqueur post-submit OK : l'éditeur se ferme → bouton "Modifier"
      // réapparaît en mode display. On évite getByText("Version modifiée")
      // qui matcherait aussi le contenu du textarea avant la fin du POST.
      await expect(
        page.getByRole("button", { name: "Modifier", exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      // Vérif DB v2.
      const { data: v2 } = await admin
        .from("reviews")
        .select(
          "producer_response, producer_response_at, producer_response_updated_at, producer_response_locked_at",
        )
        .eq("id", reviewId)
        .single();
      expect(v2!.producer_response).toBe("Version modifiée");
      expect(v2!.producer_response_at).toBe(v1RespAt); // unchanged
      expect(v2!.producer_response_locked_at).toBe(v1LockAt); // unchanged
      expect(v2!.producer_response_updated_at).not.toBeNull();
    } finally {
      if (reviewId) await cleanupReview(ctx, reviewId);
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("suppression dans 24h → producer_response NULL + status removed_producer", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await createTestProducer(ctx, {
      suffix: "resp-del",
      statut: "public",
    });
    const consumer = await createTestUser(ctx, { suffix: "resp-del-cons" });

    let reviewId: string | null = null;
    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "completed",
      });
      reviewId = await insertPublishedReview(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        orderId: order.orderId,
      });

      await loginAs(page, producer.user);
      await page.goto("/mes-avis");
      await openFirstReview(page);

      // Publish.
      await page.getByPlaceholder(/Votre réponse publique/i).fill("À supprimer");
      await page.getByRole("button", { name: /Publier la réponse/i }).click();
      await expect(page.getByText("À supprimer")).toBeVisible({ timeout: 10_000 });

      // Capture le confirm() natif (window.confirm) pour auto-accept.
      page.on("dialog", (dialog) => dialog.accept());

      await page.getByRole("button", { name: "Supprimer", exact: true }).click();

      // Marqueur UI : retour à l'état "Répondre à cet avis" (pas de réponse).
      await expect(
        page.getByText(/Répondre à cet avis/i),
      ).toBeVisible({ timeout: 10_000 });

      // Vérif DB.
      const admin = getReadOnlyAdminClient();
      const { data: row } = await admin
        .from("reviews")
        .select("producer_response, producer_response_status")
        .eq("id", reviewId)
        .single();
      expect(row!.producer_response).toBeNull();
      expect(row!.producer_response_status).toBe("removed_producer");
    } finally {
      if (reviewId) await cleanupReview(ctx, reviewId);
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("mobile : ouverture d'un avis sans débordement horizontal", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await createTestProducer(ctx, {
      suffix: "resp-mobile",
      statut: "public",
    });
    const consumer = await createTestUser(ctx, { suffix: "resp-mobile-cons" });

    let reviewId: string | null = null;
    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "completed",
      });
      reviewId = await insertPublishedReview(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        orderId: order.orderId,
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await loginAs(page, producer.user);
      await page.goto("/mes-avis");
      await expect(
        page.getByRole("heading", { name: "Mes avis", exact: true }),
      ).toBeVisible();

      await openFirstReview(page);
      await expect(page.getByPlaceholder(/Votre réponse publique/i)).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBe(true);
    } finally {
      if (reviewId) await cleanupReview(ctx, reviewId);
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});

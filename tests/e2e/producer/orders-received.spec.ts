/**
 * E2E producer/orders-received — flux de gestion des commandes côté
 * producer sur /commandes.
 *
 * Couverture (5 tests) :
 *   1. Liste : producer voit ses commandes dans les onglets À confirmer /
 *      Confirmées / Terminées (counts + marqueurs visibles).
 *   2. Confirm pending → confirmed : action "Confirmer la commande" dans
 *      l'onglet "À confirmer" → DB.statut='confirmed' + email
 *      `order_confirmed_consumer` capturé.
 *   3. Cancel pending : action "Annuler" → DB.statut='cancelled' +
 *      closure_reason='producer_cancel' + email `order_cancelled` capturé
 *      + stock restauré (trigger `orders_restore_stock_after_cancel`).
 *   4. RLS isolation : producer A ne voit pas la commande de producer B
 *      sur sa propre /commandes (bypass régression Phase 3 SSR).
 *   5. Transition bloquée pending → completed : POST /api/orders/:id/complete
 *      sur une commande pending retourne 409 (state machine refuse skip
 *      pending → completed sans passer par confirmed).
 *
 * Cleanup : ordering FK respect — cleanupOrdersForProducers AVANT
 * cleanupAllTrackedUsers (afterEach cascade users → producers).
 *
 * Resend : 2 emails capturés (templates order_confirmed_consumer +
 * order_cancelled). Compatible quota 3000/mois.
 */

import { test, expect } from "../helpers/test-context";
import { seedProducer, seedConsumer } from "../helpers/db-seed";
import { createTestOrder, cleanupOrdersForProducers } from "../helpers/order-lifecycle";
import { loginAs } from "../helpers/user-lifecycle";
import { waitForCapturedEmail } from "../helpers/mailbox";
import { getReadOnlyAdminClient } from "../helpers/supabase-admin";

test.describe("Producer — Orders received (/commandes)", () => {
  test("liste les commandes par onglet (pending/confirmed/completed)", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "ord-list",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "ord-list-cons" });

    try {
      const orderPending = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `ORDLIST-${Date.now()}-P`,
        statut: "pending",
        daysAhead: 1,
      });
      const orderConfirmed = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `ORDLIST-${Date.now()}-C`,
        statut: "confirmed",
        daysAhead: 2,
      });
      const orderCompleted = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `ORDLIST-${Date.now()}-D`,
        statut: "completed",
        daysAhead: 3,
      });

      await loginAs(page, producer.user);
      await page.goto("/commandes");
      await expect(
        page.getByRole("heading", { name: "Vos commandes" }),
      ).toBeVisible();

      // Onglet par défaut "À confirmer" : voir orderPending, pas les autres.
      await expect(
        page.getByText(orderPending.codeCommande, { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText(orderConfirmed.codeCommande, { exact: false }),
      ).toHaveCount(0);

      // Switch onglet "Confirmées".
      await page.getByRole("button", { name: /Confirmées/i }).click();
      await expect(
        page.getByText(orderConfirmed.codeCommande, { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText(orderPending.codeCommande, { exact: false }),
      ).toHaveCount(0);

      // Switch onglet "Terminées".
      await page.getByRole("button", { name: /Terminées/i }).click();
      await expect(
        page.getByText(orderCompleted.codeCommande, { exact: false }),
      ).toBeVisible();
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("confirm pending → confirmed + email consumer envoyé", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "ord-confirm",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "ord-confirm-cons" });

    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `ORDCONF-${Date.now()}`,
        statut: "pending",
      });

      const sinceTs = new Date();
      await loginAs(page, producer.user);
      await page.goto("/commandes");
      await expect(
        page.getByRole("heading", { name: "Vos commandes" }),
      ).toBeVisible();

      // Localise l'article de la commande pending pour scoper le clic
      // bouton Confirmer (évite collision si plusieurs orders pending).
      const article = page
        .locator("article", {
          hasText: order.codeCommande,
        })
        .first();
      await expect(article).toBeVisible();
      await article
        .getByRole("button", { name: /Confirmer la commande/i })
        .click();

      // Marqueur UI : la commande quitte l'onglet pending (le compteur
      // diminue ou la card disparaît). On vérifie via DB qui est
      // déterministe vs polling UI.
      const admin = getReadOnlyAdminClient();
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("orders")
              .select("statut, confirmed_at")
              .eq("id", order.orderId)
              .single();
            return data?.statut;
          },
          { timeout: 10_000 },
        )
        .toBe("confirmed");

      const { data: row } = await admin
        .from("orders")
        .select("statut, confirmed_at")
        .eq("id", order.orderId)
        .single();
      expect(row?.confirmed_at).not.toBeNull();

      // Email consumer "order_confirmed_consumer" capturé via Resend
      // test-mode (cf. lib/resend/send.ts + RESEND_TEST_MODE=true).
      const mail = await waitForCapturedEmail(ctx, {
        to: consumer.email,
        template: "order_confirmed_consumer",
        since: sinceTs,
        timeoutMs: 15_000,
      });
      expect(mail.to_email).toBe(consumer.email);
      expect(mail.metadata.order_id).toBe(order.orderId);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("cancel pending → cancelled + email + stock restauré (trigger)", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "ord-cancel",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "ord-cancel-cons" });

    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `ORDCXL-${Date.now()}`,
        statut: "pending",
      });

      const admin = getReadOnlyAdminClient();
      // Snapshot stock initial (createTestOrder pose stock_disponible=100,
      // sans décrémenter à l'INSERT direct car pas de RPC). Le trigger
      // orders_restore_stock_after_cancel va incrémenter de la quantité
      // order_items (=1) à la transition pending → cancelled.
      const { data: stockBefore } = await admin
        .from("products")
        .select("stock_disponible")
        .eq("id", order.productId)
        .single();
      const initialStock = Number(stockBefore?.stock_disponible ?? 0);

      const sinceTs = new Date();
      await loginAs(page, producer.user);
      await page.goto("/commandes");
      await expect(
        page.getByRole("heading", { name: "Vos commandes" }),
      ).toBeVisible();

      const article = page
        .locator("article", { hasText: order.codeCommande })
        .first();
      await expect(article).toBeVisible();
      await article.getByRole("button", { name: "Annuler", exact: true }).click();

      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("orders")
              .select("statut")
              .eq("id", order.orderId)
              .single();
            return data?.statut;
          },
          { timeout: 10_000 },
        )
        .toBe("cancelled");

      const { data: row } = await admin
        .from("orders")
        .select("statut, closure_reason, cancelled_at")
        .eq("id", order.orderId)
        .single();
      expect(row?.statut).toBe("cancelled");
      expect(row?.closure_reason).toBe("producer_cancel");
      expect(row?.cancelled_at).not.toBeNull();

      // Stock restauré via trigger DB (cf. migration
      // 20260427200000_restore_stock_on_order_cancel). Le trigger fire
      // sur AFTER UPDATE statut quand OLD ∈ (pending,confirmed,ready) ET
      // NEW ∈ (cancelled,refunded). +1 unite par order_item.
      const { data: stockAfter } = await admin
        .from("products")
        .select("stock_disponible")
        .eq("id", order.productId)
        .single();
      expect(Number(stockAfter?.stock_disponible ?? 0)).toBe(initialStock + 1);

      // Email consumer "order_cancelled" envoyé (template générique
      // annulation/timeout, cf. cancel/route.tsx:281).
      const mail = await waitForCapturedEmail(ctx, {
        to: consumer.email,
        template: "order_cancelled",
        since: sinceTs,
        timeoutMs: 15_000,
      });
      expect(mail.to_email).toBe(consumer.email);
      expect(mail.metadata.order_id).toBe(order.orderId);
      expect(mail.metadata.reason).toBe("producer_cancel");
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("RLS isolation — producer A ne voit pas la commande de producer B", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producerA = await seedProducer(ctx, {
      suffix: "ord-rls-a",
      statut: "public",
    });
    const producerB = await seedProducer(ctx, {
      suffix: "ord-rls-b",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "ord-rls-cons" });

    try {
      const orderA = await createTestOrder(ctx, {
        producerId: producerA.producerId,
        consumerId: consumer.id,
        codeCommande: `ORDA-${Date.now()}`,
        statut: "pending",
      });
      const orderB = await createTestOrder(ctx, {
        producerId: producerB.producerId,
        consumerId: consumer.id,
        codeCommande: `ORDB-${Date.now()}`,
        statut: "pending",
      });

      await loginAs(page, producerA.user);
      await page.goto("/commandes");
      await expect(
        page.getByRole("heading", { name: "Vos commandes" }),
      ).toBeVisible();

      // A voit sa commande, jamais celle de B (filter explicite SSR
      // .eq('producer_id', producer.id) — cf. commit Phase 3 SSR refacto).
      await expect(
        page.getByText(orderA.codeCommande, { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText(orderB.codeCommande, { exact: false }),
      ).toHaveCount(0);
    } finally {
      await cleanupOrdersForProducers([
        producerA.producerId,
        producerB.producerId,
      ]);
    }
  });

  test("transition bloquée pending → completed (state machine)", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "ord-trans",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "ord-trans-cons" });

    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        codeCommande: `ORDTRS-${Date.now()}`,
        statut: "pending",
      });

      await loginAs(page, producer.user);

      // POST /api/orders/:id/complete avec le code commande sur une
      // commande pending → 409 InvalidOrderTransitionError. La state
      // machine (lib/orders/stateMachine.ts) interdit pending → completed
      // sans passer par confirmed.
      const res = await page.request.post(
        `/api/orders/${order.orderId}/complete`,
        {
          data: { code_commande: order.codeCommande },
        },
      );
      expect(res.status()).toBe(409);

      // L'audit log pickup_attempt_invalid avec reason commençant par
      // "order_not_confirmed:" est posé (cf. complete/route.tsx:122-131).
      const admin = getReadOnlyAdminClient();
      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("event_type, metadata, created_at")
        .eq("user_id", producer.user.id)
        .eq("event_type", "pickup_attempt_invalid")
        .gte("created_at", new Date(Date.now() - 60_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(5);
      expect(auditRows?.length ?? 0).toBeGreaterThanOrEqual(1);

      // Statut DB inchangé.
      const { data: row } = await admin
        .from("orders")
        .select("statut")
        .eq("id", order.orderId)
        .single();
      expect(row?.statut).toBe("pending");
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});

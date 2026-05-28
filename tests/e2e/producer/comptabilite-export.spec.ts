/**
 * E2E producer/comptabilite — page /comptabilite + export CSV.
 *
 * Couverture (3 tests) :
 *   1. /comptabilite : page accessible, présente sélecteurs date "Du" /
 *      "Au" + bouton "Télécharger CSV".
 *   2. Export CSV (cas avec données) : seed 1 commande completed + GET
 *      /api/exports/producer/comptabilite.csv via page.request → réponse
 *      Content-Type CSV + UTF-8 BOM + headers + ligne data + email
 *      consumer masqué.
 *   3. Filtre période : seed 2 commandes completed à 2 dates distinctes,
 *      requête CSV sur période qui n'inclut qu'une des 2 → seule
 *      l'order matchant apparaît dans le CSV.
 *
 * Notes :
 *   - Le filtre période est `completed_at` (pas created_at) — comportement
 *     comptable français cf. comptabilite.csv route.ts:23-27.
 *   - Email consumer masqué (j***@d***.fr) defense-in-depth RGPD.
 *
 * Resend : aucun email envoyé (export pure GET CSV).
 */

import { test, expect } from "../helpers/test-context";
import { seedProducer, seedConsumer } from "../helpers/db-seed";
import { createTestOrder, cleanupOrdersForProducers } from "../helpers/order-lifecycle";
import { loginAs } from "../helpers/user-lifecycle";
import { getReadOnlyAdminClient } from "../helpers/supabase-admin";

test.describe("Producer — Comptabilité (/comptabilite + CSV/PDF export)", () => {
  test("page /comptabilite affiche synthèse + boutons CSV/PDF", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: "compta-page",
      statut: "public",
    });

    await loginAs(page, producer.user);
    await page.goto("/comptabilite");

    await expect(
      page.getByRole("heading", { name: /Export comptable/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/^Du$/i)).toBeVisible();
    await expect(page.getByLabel(/^Au$/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Télécharger CSV/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Télécharger le PDF/i }),
    ).toBeVisible();
    await expect(page.getByText(/Chiffre d'affaires TTC/i)).toBeVisible();
    await expect(page.getByText(/Commission TerrOir/i)).toBeVisible();
    await expect(page.getByText(/Net producteur/i)).toBeVisible();
  });

  test("export CSV avec 1 commande completed → headers + 1 ligne + UTF-8 BOM + email masqué", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "compta-csv",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "compta-csv-cons" });

    try {
      const order = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "completed",
      });

      // Force completed_at = aujourd'hui (createTestOrder n'initialise pas
      // completed_at quand statut='completed' est posé en raw INSERT).
      // Sans ce write, le filter .gte('completed_at', from) écarte l'order.
      const admin = getReadOnlyAdminClient();
      const today = new Date();
      const todayIso = today.toISOString();
      await admin
        .from("orders")
        .update({ completed_at: todayIso })
        .eq("id", order.orderId);

      await loginAs(page, producer.user);

      const todayStr = today.toISOString().slice(0, 10);
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const fromStr = yesterday.toISOString().slice(0, 10);

      const res = await page.request.get(
        `/api/exports/producer/comptabilite.csv?from=${fromStr}&to=${todayStr}`,
      );
      expect(res.status()).toBe(200);

      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toMatch(/text\/csv/i);
      expect(contentType).toMatch(/utf-8/i);

      const disposition = res.headers()["content-disposition"] ?? "";
      expect(disposition).toMatch(/attachment/i);
      expect(disposition).toMatch(/comptabilite_producer_/i);

      const buffer = await res.body();
      // UTF-8 BOM = 0xEF 0xBB 0xBF en début de fichier (cf. doctrine
      // serializeRowsToCsv lib/exports/csv.ts).
      expect(buffer[0]).toBe(0xef);
      expect(buffer[1]).toBe(0xbb);
      expect(buffer[2]).toBe(0xbf);

      const text = buffer.toString("utf-8");
      // Header présent (1ère ligne après BOM).
      expect(text).toContain("commande_id");
      expect(text).toContain("date_validation");
      expect(text).toContain("consumer_email_masked");
      expect(text).toContain("commission_terroir_6%");
      expect(text).toContain("payout_net");

      // La commande créée apparaît (commande_id en colonne 1).
      expect(text).toContain(order.orderId);

      // Email consumer masqué : pattern j***@d***.fr (jamais l'email
      // brut). On vérifie que l'email original n'apparaît PAS et qu'on
      // a au moins 1 substring "***" dans le contenu (marqueur masking).
      expect(text).not.toContain(consumer.email);
      expect(text).toMatch(/\*\*\*/);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  test("filtre période : commande hors plage exclue du CSV", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "compta-rng",
      statut: "public",
    });
    const consumer = await seedConsumer(ctx, { suffix: "compta-rng-cons" });

    try {
      const orderInRange = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "completed",
        daysAhead: 1,
      });
      const orderOutOfRange = await createTestOrder(ctx, {
        producerId: producer.producerId,
        consumerId: consumer.id,
        statut: "completed",
        daysAhead: 2,
      });

      const admin = getReadOnlyAdminClient();
      const today = new Date();
      // orderInRange : completed aujourd'hui.
      await admin
        .from("orders")
        .update({ completed_at: today.toISOString() })
        .eq("id", orderInRange.orderId);
      // orderOutOfRange : completed il y a 30 jours (hors plage).
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
      await admin
        .from("orders")
        .update({ completed_at: thirtyDaysAgo.toISOString() })
        .eq("id", orderOutOfRange.orderId);

      await loginAs(page, producer.user);

      const todayStr = today.toISOString().slice(0, 10);
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const fromStr = yesterday.toISOString().slice(0, 10);

      const res = await page.request.get(
        `/api/exports/producer/comptabilite.csv?from=${fromStr}&to=${todayStr}`,
      );
      expect(res.status()).toBe(200);
      const text = (await res.body()).toString("utf-8");

      // orderInRange présent, orderOutOfRange absent.
      expect(text).toContain(orderInRange.orderId);
      expect(text).not.toContain(orderOutOfRange.orderId);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});

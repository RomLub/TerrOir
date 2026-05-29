/**
 * E2E checkout CGV — opposabilité juridique au paiement.
 *
 * Couverture :
 *   1. Avant cocher CGV : message "acceptez les CGV" visible, PaymentElement
 *      Stripe pas rendu, AUCUNE order créée en DB pour ce consumer.
 *   2. Cocher CGV → auto-init débloquée : POST /api/orders/create + PI Stripe
 *      → order créée avec cgv_accepted_at récent + cgv_version = '1.0'.
 *   3. Lien "/cgv" dans le label : target="_blank".
 *
 * Pattern :
 *   - Setup via createTestProducer + createTestUser (consumer) — bypass UI signup
 *     pour vitesse, pas de mail Resend gaspillé.
 *   - Producer activé stripe_charges_enabled=true côté DB (équivalent post-KYC),
 *     bypass guard M-6 dans /api/stripe/create-payment-intent.
 *   - Panier injecté via localStorage (store Zustand 'terroir_cart').
 *   - Pas de complétion challenge 3DS UI (driver iframe Stripe headless = instable,
 *     cf. stripe-3ds-matrix.spec.ts trade-off documenté). On valide la persistance
 *     CGV au moment où l'order est créée (avant le challenge) — le flow 3DS lui-même
 *     est déjà couvert par stripe-3ds-matrix et stripe-decline.
 *
 * Cleanup :
 *   - Users (producer + consumer) : auto via fixture afterEach cleanupAllTrackedUsers.
 *   - Order + order_items + product + slot : delete explicite admin (pas de cascade
 *     FK ici). Pattern aligné stripe-3ds-matrix.spec.ts:cleanupSetup().
 */

import { test, expect } from "../helpers/test-context";
import { createTestProducer } from "../helpers/producer-lifecycle";
import { createTestUser, loginAs } from "../helpers/user-lifecycle";
import { getRawAdminClient } from "../helpers/supabase-admin";

interface CheckoutSetup {
  producerId: string;
  productId: string;
  slotId: string;
  consumerId: string;
  consumerEmail: string;
  dateRetrait: string;
  productPrice: number;
}

async function setupCheckout(
  page: import("@playwright/test").Page,
  ctx: import("../helpers/supabase-admin").TestContext,
  scenarioSuffix: string,
  options: Partial<{
    pickupAvailabilityMode: "all_shared_slots" | "selected_slots";
  }> = {},
): Promise<CheckoutSetup> {
  const admin = getRawAdminClient();

  const producer = await createTestProducer(ctx, {
    suffix: `cgv-${scenarioSuffix}`,
    statut: "public",
  });

  // Bypass guard charges_enabled (audit M-6) pour permettre la création du PI.
  await admin
    .from("producers")
    .update({
      stripe_charges_enabled: true,
      stripe_payouts_enabled: true,
      stripe_details_submitted: true,
    })
    .eq("id", producer.producerId);

  const productPrice = 12.5;
  const { data: product, error: productErr } = await admin
    .from("products")
    .insert({
      producer_id: producer.producerId,
      nom: `CGV Test Product (${scenarioSuffix})`,
      description: "Produit créé par checkout-cgv.spec.ts",
      prix: productPrice,
      unite: "piece",
      poids_estime_kg: 1,
      stock_disponible: 100,
      stock_illimite: false,
      delai_preparation_jours: 1,
      active: true,
      pickup_availability_mode:
        options.pickupAvailabilityMode ?? "all_shared_slots",
    })
    .select("id")
    .single();
  if (productErr || !product) {
    throw new Error(`setupCheckout product insert: ${productErr?.message}`);
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2); // J+2 pour respecter delai_preparation_jours
  tomorrow.setHours(10, 0, 0, 0);
  const slotEnd = new Date(tomorrow);
  slotEnd.setHours(11, 0, 0, 0);

  const { data: slot, error: slotErr } = await admin
    .from("slots")
    .insert({
      producer_id: producer.producerId,
      starts_at: tomorrow.toISOString(),
      ends_at: slotEnd.toISOString(),
      capacity_per_slot: 5,
      active: true,
    })
    .select("id")
    .single();
  if (slotErr || !slot) {
    throw new Error(`setupCheckout slot insert: ${slotErr?.message}`);
  }

  const consumer = await createTestUser(ctx, {
    suffix: `cgv-cons-${scenarioSuffix}`,
  });
  await page.context().clearCookies();
  await loginAs(page, consumer);

  const dateRetrait = tomorrow.toISOString().slice(0, 10);

  return {
    producerId: producer.producerId,
    productId: product.id as string,
    slotId: slot.id as string,
    consumerId: consumer.id,
    consumerEmail: consumer.email,
    dateRetrait,
    productPrice,
  };
}

async function cleanupCheckoutData(setup: CheckoutSetup): Promise<void> {
  const admin = getRawAdminClient();
  // Récupère les orders créées par ce consumer pour purger order_items + orders
  // (la fixture cleanup ne couvre pas orders parce qu'il n'y a pas de FK CASCADE
  // depuis users.id vers orders.consumer_id — c'est ON DELETE NO ACTION).
  const { data: orders } = await admin
    .from("orders")
    .select("id")
    .eq("consumer_id", setup.consumerId);
  if (orders && orders.length > 0) {
    const orderIds = orders.map((o) => o.id as string);
    await admin.from("order_items").delete().in("order_id", orderIds);
    await admin.from("orders").delete().in("id", orderIds);
  }
  await admin.from("products").delete().eq("id", setup.productId);
  await admin.from("slots").delete().eq("id", setup.slotId);
}

async function injectCart(
  page: import("@playwright/test").Page,
  setup: CheckoutSetup,
): Promise<void> {
  // Format Zustand persist 'terroir_cart' v1 (cf lib/store/cart.ts).
  const cartPayload = {
    state: {
      items: [
        {
          productId: setup.productId,
          producerId: setup.producerId,
          slug: "test-producer",
          nom: "CGV Test Product",
          prix: setup.productPrice,
          unite: "piece",
          quantite: 1,
          creneauId: setup.slotId,
          dateRetrait: setup.dateRetrait,
          producerName: "Test Producer",
          image: null,
        },
      ],
    },
    version: 1,
  };

  // Pose le localStorage AVANT navigation /compte/checkout : la page lit
  // useCartStore au mount et hydrate depuis ce key.
  await page.goto("/compte"); // page valide pour avoir un origin
  await page.evaluate((payload) => {
    window.localStorage.setItem("terroir_cart", JSON.stringify(payload));
  }, cartPayload);
}

test.describe("Checkout CGV (opposabilité juridique)", () => {
  test("avant cocher CGV : pas de PaymentElement, pas d'order créée en DB", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);
    const setup = await setupCheckout(page, ctx, "gate");

    try {
      await injectCart(page, setup);
      await page.goto("/compte/checkout");

      // Attendre l'hydratation (le composant render "Préparation du paiement…"
      // pendant ~quelques ms, puis bascule sur le contenu une fois hydrated).
      await expect(
        page.getByRole("heading", { name: /Finaliser la commande/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Le message gate doit être visible.
      await expect(
        page.getByText(
          /Pour finaliser (ta|votre) commande, accepte[z]? les conditions générales de vente/i,
        ),
      ).toBeVisible();

      // La checkbox CGV est visible et non cochée.
      const cgvCheckbox = page.getByRole("checkbox", {
        name: /Conditions générales de vente/i,
      });
      await expect(cgvCheckbox).toBeVisible();
      await expect(cgvCheckbox).not.toBeChecked();

      // PaymentElement Stripe ne doit PAS être rendu (l'auto-init est gated).
      // Le PaymentElement Stripe injecte un iframe avec name commençant par "__privateStripeFrame".
      const stripeIframe = page.locator('iframe[name^="__privateStripeFrame"]');
      await expect(stripeIframe).toHaveCount(0);

      // Le message "Initialisation du paiement…" ne doit pas apparaître non plus
      // (l'auto-init n'est pas lancée tant que CGV non cochée).
      await expect(
        page.getByText(/Initialisation du paiement/i),
      ).toHaveCount(0);

      // Aucune order n'a été créée en DB pour ce consumer.
      const admin = getRawAdminClient();
      const { count, error } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("consumer_id", setup.consumerId);
      expect(error?.message).toBeUndefined();
      expect(count).toBe(0);
    } finally {
      await cleanupCheckoutData(setup);
    }
  });

  test("checkout bloque un panier sans creneau commun", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);
    const setup = await setupCheckout(page, ctx, "slot-conflict", {
      pickupAvailabilityMode: "selected_slots",
    });

    try {
      await injectCart(page, setup);
      await page.goto("/compte/checkout");

      await expect(
        page.getByRole("heading", { name: /Finaliser la commande/i }),
      ).toBeVisible({ timeout: 15_000 });

      const cgvCheckbox = page.getByRole("checkbox", {
        name: /Conditions générales de vente/i,
      });
      await cgvCheckbox.check();

      await expect(
        page.getByText(/Aucun .* retrait commun .* disponible/i),
      ).toBeVisible({ timeout: 45_000 });
      await expect(
        page.locator('iframe[name^="__privateStripeFrame"]'),
      ).toHaveCount(0);

      const admin = getRawAdminClient();
      const { count, error } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("consumer_id", setup.consumerId);
      expect(error?.message).toBeUndefined();
      expect(count).toBe(0);
    } finally {
      await cleanupCheckoutData(setup);
    }
  });

  test("cocher CGV → order créée avec cgv_accepted_at + cgv_version='1.0'", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000); // POST orders/create + create-payment-intent + Stripe API

    const setup = await setupCheckout(page, ctx, "happy");
    const submitTimestamp = Date.now();

    try {
      await injectCart(page, setup);
      await page.goto("/compte/checkout");

      await expect(
        page.getByRole("heading", { name: /Finaliser la commande/i }),
      ).toBeVisible({ timeout: 15_000 });

      const cgvCheckbox = page.getByRole("checkbox", {
        name: /Conditions générales de vente/i,
      });
      await cgvCheckbox.check();
      await expect(cgvCheckbox).toBeChecked();

      // L'auto-init lance POST /api/orders/create puis create-payment-intent.
      // Marqueur stable : soit le PaymentElement Stripe apparaît (succès flow),
      // soit un message d'erreur. On waitForResponse sur orders/create pour
      // découpler du timing UI Stripe.
      const orderResponse = await page.waitForResponse(
        (resp) =>
          resp.url().includes("/api/orders/create") &&
          resp.request().method() === "POST",
        { timeout: 30_000 },
      );
      expect(
        orderResponse.status(),
        `orders/create: ${await orderResponse.text()}`,
      ).toBe(200);

      // Query DB pour vérifier la persistance CGV. L'order est créée par la RPC
      // create_order_with_items + UPDATE post-RPC pour cgv_accepted_at/version.
      const admin = getRawAdminClient();
      const { data: orderRow, error } = await admin
        .from("orders")
        .select("id, consumer_id, cgv_accepted_at, cgv_version, montant_total, statut")
        .eq("consumer_id", setup.consumerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      expect(error?.message).toBeUndefined();
      expect(orderRow, `order pour consumer ${setup.consumerId}`).not.toBeNull();
      const order = orderRow!;

      expect(order.cgv_version).toBe("1.0");
      expect(order.cgv_accepted_at, "cgv_accepted_at peuplé").toBeTruthy();
      expect(order.statut).toBe("pending"); // pré-paiement Stripe
      expect(Number(order.montant_total)).toBeGreaterThan(0);

      const acceptedMs = new Date(order.cgv_accepted_at as string).getTime();
      expect(acceptedMs).toBeGreaterThanOrEqual(submitTimestamp - 5_000);
      expect(acceptedMs).toBeLessThanOrEqual(submitTimestamp + 90_000);

      // PaymentElement Stripe doit s'être initialisé (auto-init débloquée par cocher).
      // L'iframe peut prendre 1-3s à s'afficher après le PI. On wait avec timeout
      // raisonnable mais on ne fait PAS de saisie carte (3DS hors scope, cf comment
      // header).
      await expect(
        page.locator('iframe[name^="__privateStripeFrame"]').first(),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await cleanupCheckoutData(setup);
    }
  });

  test("lien CGV ouvre dans nouvel onglet", async ({ page, ctx }) => {
    test.setTimeout(45_000);
    const setup = await setupCheckout(page, ctx, "link");

    try {
      await injectCart(page, setup);
      await page.goto("/compte/checkout");

      await expect(
        page.getByRole("heading", { name: /Finaliser la commande/i }),
      ).toBeVisible({ timeout: 15_000 });

      const cgvLink = page.getByRole("link", {
        name: /Conditions générales de vente/i,
      });
      await expect(cgvLink).toHaveAttribute("target", "_blank");
      await expect(cgvLink).toHaveAttribute("href", "/cgv");
      await expect(cgvLink).toHaveAttribute("rel", /noopener/);
    } finally {
      await cleanupCheckoutData(setup);
    }
  });
});

import { test, expect } from '../helpers/test-context';
import { seedProducer, seedProduct } from '../helpers/db-seed';
import {
  getRawAdminClient,
  trackRowId,
  type TestContext,
} from '../helpers/supabase-admin';

const CART_KEY = 'terroir_cart';

type StoredCartItem = {
  productId: string;
  producerId: string;
  slug: string;
  nom: string;
  prix: number;
  unite: string;
  quantite: number;
  creneauId: string;
  dateRetrait: string;
  producerName?: string;
  image?: string | null;
};

function buildCartPayload(items: StoredCartItem[]): string {
  return JSON.stringify({ state: { items }, version: 1 });
}

async function setCart(
  page: import('@playwright/test').Page,
  items: StoredCartItem[],
) {
  await page.addInitScript(({ key, payload }) => {
    window.localStorage.setItem(key, payload);
  }, { key: CART_KEY, payload: buildCartPayload(items) });
}

function toParisDateISO(isoUtc: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(isoUtc));
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${d}`;
}

async function seedPickupSlot(
  ctx: TestContext,
  producerId: string,
  startsAt: Date,
): Promise<{ id: string; startsAt: string }> {
  const admin = getRawAdminClient();
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const { data, error } = await admin
    .from('slots')
    .insert({
      producer_id: producerId,
      rule_id: null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      capacity_per_slot: 5,
      active: true,
      availability_scope: 'shared',
    })
    .select('id, starts_at')
    .single();
  if (error || !data) {
    throw new Error(`seedPickupSlot insert failed: ${error?.message ?? 'no data'}`);
  }
  trackRowId(ctx, data.id as string);
  return { id: data.id as string, startsAt: data.starts_at as string };
}

function cartItem(params: {
  productId: string;
  producerId: string;
  slug: string;
  nom: string;
  creneauId: string;
  startsAt: string;
}): StoredCartItem {
  return {
    productId: params.productId,
    producerId: params.producerId,
    slug: params.slug,
    nom: params.nom,
    prix: 10,
    unite: 'piece',
    quantite: 1,
    creneauId: params.creneauId,
    dateRetrait: toParisDateISO(params.startsAt),
    producerName: 'Ferme prevention',
    image: null,
  };
}

test.describe('fiche produit - prevention incompatibilite panier', () => {
  test('panier vide : ajout normal depuis la fiche produit', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const producer = await seedProducer(ctx, {
      suffix: 'slot-prevent-empty',
      statut: 'public',
      nomExploitation: 'Ferme prevention panier vide',
    });
    await seedPickupSlot(
      ctx,
      producer.producerId,
      new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    );
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `Produit prevention vide ${Date.now()}`,
      stockDisponible: 20,
      active: true,
    });

    await setCart(page, []);
    await page.goto(`/producteurs/${producer.slug}/produits/${product.id}`);
    await page.locator('button[aria-pressed]').first().click();
    await page.getByRole('button', { name: /Ajouter au panier/i }).click();

    await expect(
      page.getByRole('button', { name: /Ajouté au panier/i }),
    ).toBeVisible();
  });

  test('panier compatible : seul le creneau du panier reste selectable', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const producer = await seedProducer(ctx, {
      suffix: 'slot-prevent-ok',
      statut: 'public',
      nomExploitation: 'Ferme prevention compatible',
    });
    const slotA = await seedPickupSlot(
      ctx,
      producer.producerId,
      new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
    );
    await seedPickupSlot(
      ctx,
      producer.producerId,
      new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    );
    const productInCart = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `Produit deja panier ${Date.now()}`,
      stockDisponible: 20,
      active: true,
    });
    const productToAdd = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `Produit compatible panier ${Date.now()}`,
      stockDisponible: 20,
      active: true,
    });

    await setCart(page, [
      cartItem({
        productId: productInCart.id,
        producerId: producer.producerId,
        slug: producer.slug,
        nom: productInCart.nom,
        creneauId: slotA.id,
        startsAt: slotA.startsAt,
      }),
    ]);
    await page.goto(`/producteurs/${producer.slug}/produits/${productToAdd.id}`);

    await expect(page.getByText(/créneaux grisés/i)).toBeVisible();
    await page.locator('button[aria-pressed]').first().click();
    await page.getByRole('button', { name: /1 créneau/i }).nth(1).click();
    await expect(
      page.getByRole('button', { name: /Pas avec panier/i }).first(),
    ).toBeDisabled();

    await page.getByRole('button', { name: /Ajouter au panier/i }).click();
    await expect(
      page.getByRole('button', { name: /Ajouté au panier/i }),
    ).toBeVisible();
  });

  test('panier incompatible : ajout bloque avant panier', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const admin = getRawAdminClient();
    const producer = await seedProducer(ctx, {
      suffix: 'slot-prevent-ko',
      statut: 'public',
      nomExploitation: 'Ferme prevention incompatible',
    });
    const slotA = await seedPickupSlot(
      ctx,
      producer.producerId,
      new Date(Date.now() + 11 * 24 * 60 * 60 * 1000),
    );
    const slotB = await seedPickupSlot(
      ctx,
      producer.producerId,
      new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
    );
    const productInCart = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `Produit panier incompatible ${Date.now()}`,
      stockDisponible: 20,
      active: true,
    });
    const limitedProduct = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `Produit limite incompatible ${Date.now()}`,
      stockDisponible: 20,
      active: true,
      pickupAvailabilityMode: 'selected_slots',
    });
    const { error: linkError } = await admin
      .from('product_slot_availabilities')
      .insert({ product_id: limitedProduct.id, slot_id: slotB.id });
    expect(linkError?.message).toBeUndefined();

    await setCart(page, [
      cartItem({
        productId: productInCart.id,
        producerId: producer.producerId,
        slug: producer.slug,
        nom: productInCart.nom,
        creneauId: slotA.id,
        startsAt: slotA.startsAt,
      }),
    ]);
    await page.goto(`/producteurs/${producer.slug}/produits/${limitedProduct.id}`);

    await expect(
      page.getByText(/Ce produit n'a pas de créneau de retrait commun/i),
    ).toBeVisible();
    await expect(page.getByText(/validez d'abord votre panier actuel/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Non disponible/i }).first(),
    ).toBeDisabled();
    await page.getByRole('button', { name: /1 créneau/i }).nth(1).click();
    await expect(
      page.getByRole('button', { name: /Pas avec panier/i }).first(),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: /Produit incompatible avec le panier/i }),
    ).toBeDisabled();
  });
});

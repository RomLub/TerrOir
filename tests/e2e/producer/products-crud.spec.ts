/**
 * E2E producer — CRUD products côté producer (catalogue).
 *
 * Stratégie : la création/édition produit en prod passe majoritairement
 * par Supabase JS browser-side (RLS owner all sur products). Pour rester
 * test E2E utilité maximale et minimiser le couplage UI fragile, on teste
 * via `seedProduct` (admin, bypass RLS) pour le state DB initial puis :
 *   - Pour l'UPDATE stock : on tape la route applicative
 *     PATCH /api/producer/products/[id] (la seule route applicative côté
 *     producer products, qui contient le hook synchrone notifyBackInStock).
 *   - Pour la lecture catalogue : navigation UI.
 *   - Pour le RLS isolation : on crée 2 producers + on tente PATCH cross-
 *     tenant (403 attendu).
 *
 * Couverture (5 tests) :
 *   1. seedProduct insère row + visible côté UI catalogue.
 *   2. PATCH /api/producer/products/[id] met à jour stock + active.
 *   3. PATCH active=false → soft delete (row reste, active=false).
 *   4. Stock=0 → produit visible côté UI mais marqué hors-stock (badge).
 *   5. RLS isolation : producer B ne peut pas PATCH le product de A
 *      (403 Forbidden via ownership check route applicative).
 */

import { test, expect } from '../helpers/test-context';
import { seedProducer, seedProduct } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';

test.describe('Producer products — CRUD', () => {
  test('seedProduct insère row visible sur /catalogue côté producer', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: 'crud-list',
      statut: 'public',
    });
    const ts = Date.now();
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `CRUDLIST-${ts}`,
      stockDisponible: 50,
      active: true,
    });

    await loginAs(page, producer.user);
    await page.goto('/catalogue');

    // Marqueur stable du produit créé
    await expect(
      page.getByRole('heading', { name: product.nom }),
      `Le produit ${product.nom} doit être visible sur la page catalogue`,
    ).toBeVisible();
  });

  test('PATCH /api/producer/products/[id] met à jour stock_disponible', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: 'crud-stock',
      statut: 'public',
    });
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `CRUDSTOCK-${Date.now()}`,
      stockDisponible: 10,
      active: true,
    });

    await loginAs(page, producer.user);

    const response = await page.request.patch(`/api/producer/products/${product.id}`, {
      data: { stock_disponible: 42 },
    });
    expect(response.status(), `PATCH body: ${await response.text()}`).toBe(200);
    const body = (await response.json()) as { stock_disponible: number };
    expect(body.stock_disponible).toBe(42);

    // DB assertion
    const admin = getRawAdminClient();
    const { data: row } = await admin
      .from('products')
      .select('stock_disponible')
      .eq('id', product.id)
      .single();
    expect(row!.stock_disponible).toBe(42);
  });

  test('PATCH active=false → soft delete (row préservée, active=false)', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: 'crud-soft',
      statut: 'public',
    });
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `CRUDSOFT-${Date.now()}`,
      active: true,
    });

    await loginAs(page, producer.user);

    const response = await page.request.patch(`/api/producer/products/${product.id}`, {
      data: { active: false },
    });
    expect(response.status()).toBe(200);

    const admin = getRawAdminClient();
    const { data: row } = await admin
      .from('products')
      .select('id, active')
      .eq('id', product.id)
      .maybeSingle();
    expect(row, 'row doit toujours exister (soft delete)').not.toBeNull();
    expect(row!.active).toBe(false);
  });

  test('stock=0 visible côté UI mais marqué hors stock', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: 'crud-oos',
      statut: 'public',
    });
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `CRUDOOS-${Date.now()}`,
      stockDisponible: 0,
      stockIllimite: false,
      active: true,
    });

    await loginAs(page, producer.user);
    await page.goto('/catalogue');

    // Le produit reste visible côté catalogue producer même hors stock
    await expect(page.getByRole('heading', { name: product.nom })).toBeVisible();
    // Badge "Épuisé" rendu par CatalogueClient.tsx pour stock_disponible=0
    // && stock_illimite=false (cf. const empty = !p.unlimited && p.stock === 0).
    const card = page.locator('article').filter({ hasText: product.nom });
    await expect(card.getByText('Épuisé', { exact: false })).toBeVisible();
  });

  test('RLS isolation : producer B ne peut PATCH le product de producer A (403)', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const producerA = await seedProducer(ctx, {
      suffix: 'crud-rls-a',
      statut: 'public',
    });
    const producerB = await seedProducer(ctx, {
      suffix: 'crud-rls-b',
      statut: 'public',
    });
    const productA = await seedProduct(ctx, {
      producerId: producerA.producerId,
      nom: `CRUDRLS-${Date.now()}`,
      stockDisponible: 10,
      active: true,
    });

    // Login en tant que B → tente PATCH product de A
    await loginAs(page, producerB.user);

    const response = await page.request.patch(`/api/producer/products/${productA.id}`, {
      data: { stock_disponible: 999 },
    });
    expect(
      response.status(),
      `PATCH cross-tenant doit être refusé (403 attendu via ownership check)`,
    ).toBe(403);

    // DB confirm : productA.stock_disponible reste 10
    const admin = getRawAdminClient();
    const { data: row } = await admin
      .from('products')
      .select('stock_disponible')
      .eq('id', productA.id)
      .single();
    expect(row!.stock_disponible).toBe(10);
  });
});

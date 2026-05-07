/**
 * Phase 2 — pages producer publiques anonymes.
 *
 * Couvre les 2 routes dynamiques :
 *   - /producteurs/[slug] : fiche producer (statut='public' filtre amont)
 *   - /producteurs/[slug]/produits/[id] : détail produit
 *
 * Pour chaque route on teste :
 *   - happy path (slug/id existant → page rendue + DOM cohérent)
 *   - 404 nominal (slug/id inexistant → notFound() Next.js → page 404)
 *
 * NB sur le status code 404 :
 *   En dev mode Next.js (Turbopack), notFound() peut renvoyer un statut
 *   HTTP 200 alors que le DOM rendu est bien la page not-found. En
 *   production, le statut est bien 404. Pour rester robuste local + CI,
 *   on assert sur le contenu DOM (heading "Cette page n'existe plus.")
 *   plutôt que sur le status code.
 *
 * Stratégie : seedProducer({statut:'public'}) + seedProduct() pour
 * disposer d'un producer/produit dédié à l'isolation du test, plutôt
 * que de dépendre d'une fixture prod. Le cleanup auto via afterEach
 * cascade auth.users → producers → products.
 */

import { test, expect } from '../helpers/test-context';
import { seedProducer, seedProduct } from '../helpers/db-seed';

test.describe('pages producer publiques anon', () => {
  test('/producteurs/[slug] producer existant statut=public → 200', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: 'page-public',
      statut: 'public',
      nomExploitation: 'Producer Page Test E2E',
    });

    const response = await page.goto(`/producteurs/${producer.slug}`);
    expect(response?.status(), 'producer page GET').toBeLessThan(400);
    // Le nom d'exploitation apparaît dans la page (header / titre).
    // .first() : le nom peut apparaître plusieurs fois (header + breadcrumb).
    await expect(
      page.getByText('Producer Page Test E2E').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('/producteurs/[slug] slug inexistant → page 404 rendue', async ({
    page,
  }) => {
    await page.goto('/producteurs/playwright-test-inexistant-slug-9999999');
    // En dev Next.js, notFound() peut servir 200 + page 404 dans le DOM.
    // On assert sur le contenu de not-found.tsx (cf. app/not-found.tsx).
    await expect(
      page.getByRole('heading', { level: 1, name: /cette page n['’]existe plus/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('/producteurs/[slug]/produits/[id] détail produit existant → 200', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: 'product-page',
      statut: 'public',
      nomExploitation: 'Producer Product Page E2E',
    });
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: `Produit Detail Test ${Date.now()}`,
      stockDisponible: 25,
      stockIllimite: false,
      active: true,
    });

    const response = await page.goto(
      `/producteurs/${producer.slug}/produits/${product.id}`,
    );
    expect(response?.status(), 'product page GET').toBeLessThan(400);
    // Le nom du produit apparaît plusieurs fois (titre, breadcrumb, alt
    // photo, etc.) — .first() évite la strict mode violation Playwright.
    await expect(page.getByText(product.nom).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('/producteurs/[slug]/produits/[id] produit inexistant → page 404 rendue', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    // Producer valide pour avoir un slug existant, ID produit bidon pour
    // forcer le notFound() côté product. UUID fictif valide format.
    const producer = await seedProducer(ctx, {
      suffix: 'product-404',
      statut: 'public',
    });

    const fakeProductId = '00000000-0000-0000-0000-000000000000';
    await page.goto(
      `/producteurs/${producer.slug}/produits/${fakeProductId}`,
    );
    await expect(
      page.getByRole('heading', { level: 1, name: /cette page n['’]existe plus/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

/**
 * E2E consumer/panier — Zustand persisté (localStorage 'terroir_cart').
 *
 * Le panier TerrOir est zero-knowledge serveur (cf. PanierClient.tsx). Il vit
 * dans le store Zustand `lib/store/cart.ts` avec persistance localStorage.
 * Pour automatiser un ajout sans driver l'UI complexe (date_retrait,
 * créneaux, slot picker), on peut soit :
 *  A. driver l'UI page produit → naturel mais brittle (slots, dates)
 *  B. injecter directement la persistance localStorage avant goto /compte/panier
 *
 * On choisit B (injection localStorage) car c'est l'approche standard pour
 * tester le store : robuste, pas de dépendance aux slots futurs réels.
 *
 * Couverture :
 *   - Panier vide : message "Ton panier est vide"
 *   - Ajout 2 items : affichage + groupement par producer + récap
 *   - Modif quantité : compteur + total mis à jour
 *   - Suppression item : disparaît du panier
 *   - Persistance après refresh : items restent en place (localStorage)
 */

import { test, expect } from '../helpers/test-context';

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
  // Format Zustand persist v1 : { state: { items }, version: 1 }
  return JSON.stringify({ state: { items }, version: 1 });
}

async function setCart(page: import('@playwright/test').Page, items: StoredCartItem[]) {
  // Le store Zustand persist hydrate au mount sur localStorage[CART_KEY].
  // On poste le payload AVANT goto pour qu'il soit lu lors de l'hydratation.
  // Sur Next.js, on doit d'abord goto une page minimale pour que le contexte
  // window soit accessible, puis poster le payload, puis goto la page panier.
  await page.addInitScript(({ key, payload }) => {
    try {
      window.localStorage.setItem(key, payload);
    } catch {
      // localStorage non disponible (mode private etc.) — fail-silent
    }
  }, { key: CART_KEY, payload: buildCartPayload(items) });
}

function fakeItem(overrides: Partial<StoredCartItem> = {}): StoredCartItem {
  const ts = Date.now();
  return {
    productId: overrides.productId ?? `prd-${ts}`,
    producerId: overrides.producerId ?? `prc-${ts}`,
    slug: overrides.slug ?? `prod-slug-${ts}`,
    nom: overrides.nom ?? 'Produit Panier Test',
    prix: overrides.prix ?? 12.5,
    unite: overrides.unite ?? 'piece',
    quantite: overrides.quantite ?? 2,
    creneauId: overrides.creneauId ?? `slot-${ts}`,
    dateRetrait: overrides.dateRetrait ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    producerName: overrides.producerName ?? 'Ferme Test',
    image: overrides.image ?? null,
  };
}

test.describe('Consumer — /compte/panier', () => {
  test('panier vide : affiche le message "Ton panier est vide"', async ({ page }) => {
    test.setTimeout(60_000);

    await setCart(page, []);
    await page.goto('/compte/panier');

    await expect(page.getByText(/Ton panier est vide/i)).toBeVisible({ timeout: 10_000 });
  });

  test('ajout localStorage : 2 items affichés + groupement par producer + récap', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const ts = Date.now();
    const items = [
      fakeItem({
        productId: `pid-${ts}-A`,
        nom: `Pommes du test ${ts}`,
        prix: 4.5,
        quantite: 2,
        unite: 'kg',
      }),
      fakeItem({
        productId: `pid-${ts}-B`,
        nom: `Carottes du test ${ts}`,
        prix: 2,
        quantite: 3,
        unite: 'kg',
      }),
    ];
    await setCart(page, items);
    await page.goto('/compte/panier');

    await expect(page.getByText(items[0].nom, { exact: false })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(items[1].nom, { exact: false })).toBeVisible();

    // Récap : sous-total = 4.5*2 + 2*3 = 15
    await expect(page.getByText(/15,00\s*€/)).toBeVisible();
  });

  test('modif quantité via bouton +/- : sous-total mis à jour', async ({ page }) => {
    test.setTimeout(60_000);

    const ts = Date.now();
    const item = fakeItem({
      productId: `pid-${ts}-Q`,
      nom: `ProduitQty-${ts}`,
      prix: 10,
      quantite: 1,
      unite: 'piece',
    });
    await setCart(page, [item]);
    await page.goto('/compte/panier');

    await expect(page.getByText(item.nom, { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // Sous-total initial = 10€
    await expect(page.getByText(/10,00\s*€/).first()).toBeVisible();

    // Click +1 (step=1 pour unite=piece)
    await page.getByRole('button', { name: '+', exact: true }).click();

    // Quantité passée à 2 → sous-total 20€ (rendu dans aside récap)
    await expect(page.getByText(/20,00\s*€/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('suppression item : disparaît du panier (état vide)', async ({ page }) => {
    test.setTimeout(60_000);

    const ts = Date.now();
    const item = fakeItem({
      productId: `pid-${ts}-DEL`,
      nom: `ProduitDel-${ts}`,
      prix: 5,
      quantite: 1,
    });
    await setCart(page, [item]);
    await page.goto('/compte/panier');

    await expect(page.getByText(item.nom, { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Retirer', exact: true }).click();

    // Le panier devient vide → message canonique
    await expect(page.getByText(/Ton panier est vide/i)).toBeVisible({
      timeout: 5_000,
    });
  });

  test('persistance localStorage : refresh garde l\'item', async ({ page }) => {
    test.setTimeout(60_000);

    const ts = Date.now();
    const item = fakeItem({
      productId: `pid-${ts}-PERSIST`,
      nom: `ProduitPersist-${ts}`,
      prix: 7,
      quantite: 1,
    });
    await setCart(page, [item]);
    await page.goto('/compte/panier');
    await expect(page.getByText(item.nom, { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // Reload : Zustand persist v1 réhydrate depuis localStorage
    await page.reload();
    await expect(page.getByText(item.nom, { exact: false })).toBeVisible({
      timeout: 10_000,
    });
  });
});

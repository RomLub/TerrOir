/**
 * Stripe helper E2E — test cards canoniques + driver Stripe Elements.
 *
 * Les tests utilisent ce module pour :
 *   - importer les numéros de cartes test Stripe documentés
 *     (https://docs.stripe.com/testing#cards)
 *   - automatiser la saisie de carte dans le PaymentElement Stripe
 *     côté checkout consumer
 *
 * NOTE Phase 1 : exporte les TEST_CARDS constants. Le helper
 * `payWithTestCard` est une stub qui sera étoffé en Phase 3 (consumer)
 * pour aligner sur le DOM réel du PaymentElement TerrOir post-T-409.
 *
 * Garde-fou : refuse de tourner si STRIPE_SECRET_KEY commence par sk_live_.
 */

import type { Page } from '@playwright/test';

export const TEST_CARDS = {
  /** Visa succès immédiat (pas de 3DS). */
  VISA_OK: '4242424242424242',
  /** Visa nécessite authentification 3DS (modal Stripe). */
  VISA_3DS_REQUIRED: '4000002500003155',
  /** Visa 3DS redirect requis (le plus contraignant). */
  VISA_3DS_REDIRECT: '4000002760003184',
  /** Carte declined générique (raison: card_declined). */
  VISA_DECLINE_GENERIC: '4000000000000002',
  /** Carte declined insufficient_funds. */
  VISA_DECLINE_INSUFFICIENT_FUNDS: '4000000000009995',
  /** Carte declined lost_card. */
  VISA_DECLINE_LOST: '4000000000009987',
  /** Carte declined stolen_card. */
  VISA_DECLINE_STOLEN: '4000000000009979',
  /** Carte declined fraudulent (fraud check trigger). */
  VISA_DECLINE_FRAUDULENT: '4100000000000019',
  /** MasterCard succès. */
  MASTERCARD_OK: '5555555555554444',
  /** Amex succès. */
  AMEX_OK: '378282246310005',
} as const;

export type TestCardKey = keyof typeof TEST_CARDS;

export const TEST_CARD_DEFAULTS = {
  exp: '12/34', // MM/YY format Stripe Elements
  cvc: '123',
  postalCode: '72000', // Le Mans, valide en checkout TerrOir Sarthe
} as const;

/**
 * Garde-fou ceinture-bretelles : appelé en test.beforeAll quand on
 * touche Stripe. Refuse une clé sk_live_ par mesure de sécurité.
 */
export function assertStripeTestMode(): void {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    throw new Error(
      `STRIPE_SECRET_KEY n'est pas une clé test (prefix=${key.slice(0, 8)}). ` +
      `Refus de tourner les helpers Stripe e2e en LIVE.`,
    );
  }
}

interface PayWithTestCardOptions {
  card: TestCardKey | string;
  exp?: string;
  cvc?: string;
  postalCode?: string;
  /** Selector du bouton submit. Default 'button[type="submit"]:has-text("Payer")'. */
  submitSelector?: string;
}

/**
 * Remplit le PaymentElement Stripe et soumet le checkout.
 *
 * Stripe Elements rend ses inputs dans un iframe sandbox — Playwright
 * doit utiliser `frameLocator` pour les cibler. Cette fonction encapsule
 * le boilerplate. À étoffer Phase 3 pour gérer les variantes (Apple
 * Pay/Google Pay buttons, 3DS modal flow, fingerprint scoring).
 */
export async function payWithTestCard(
  page: Page,
  options: PayWithTestCardOptions,
): Promise<void> {
  assertStripeTestMode();

  const cardNumber = options.card in TEST_CARDS
    ? TEST_CARDS[options.card as TestCardKey]
    : options.card;
  const exp = options.exp ?? TEST_CARD_DEFAULTS.exp;
  const cvc = options.cvc ?? TEST_CARD_DEFAULTS.cvc;
  const postalCode = options.postalCode ?? TEST_CARD_DEFAULTS.postalCode;

  // Stripe Elements iframe — nom de frame stable depuis SDK 6+.
  const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();

  await stripeFrame.getByPlaceholder(/[0-9]{4}\s+[0-9]{4}|Card number|Numéro de carte/i).fill(cardNumber);
  await stripeFrame.getByPlaceholder(/MM\s*\/\s*(YY|AA)/i).fill(exp);
  await stripeFrame.getByPlaceholder(/CVC|CVV|Cryptogramme/i).fill(cvc);

  // Postal code peut être absent selon la config dashboard Stripe (TerrOir
  // active automatic_payment_methods → Stripe le rend dynamiquement).
  try {
    const zipInput = stripeFrame.getByPlaceholder(/(ZIP|Postal|Code postal)/i);
    if (await zipInput.count() > 0) {
      await zipInput.fill(postalCode);
    }
  } catch {
    /* ZIP optionnel */
  }

  const submitSelector = options.submitSelector ?? 'button[type="submit"]:has-text("Payer")';
  await page.click(submitSelector);
}

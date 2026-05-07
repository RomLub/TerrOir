import type { StripeError } from "@stripe/stripe-js";

// T-407 — classification d'erreurs paiement consumer pour brancher l'UX
// (retry direct vs redirect order morte). 6 ErrorKind couvrent les paths
// réels observables sur le checkout :
//   - init_409 = HTTP 409 sur /api/stripe/create-payment-intent (T-406
//     guard order non-pending : webhook payment_failed a déjà cancelle,
//     ou order confirmed/completed/refunded). Order morte → redirect.
//   - 3ds_abandoned = user a fermé la modal 3DS Stripe ou n'a pas
//     répondu au challenge. PI repasse `requires_payment_method` côté
//     Stripe → retry direct OK.
//   - card_declined = carte refusée (fonds, expiration, CVC, processing).
//     Idem retry direct, suggest changer de carte. Message Stripe FR natif
//     préservé (locale 'fr' configurée sur Elements).
//   - pi_invalid = PI canceled côté Stripe (rare : timeout > 24h, cancel
//     admin). L'order est probablement déjà cancelled DB via webhook →
//     redirect order morte.
//   - network = TypeError fetch (offline, DNS, CORS preflight fail).
//   - generic = fallback Stripe error sans code reconnu. Affiche le
//     message Stripe brut pour ne pas masquer un cas inattendu.

export type ErrorKind =
  | "init_409"
  | "3ds_abandoned"
  | "card_declined"
  | "pi_invalid"
  | "network"
  | "generic";

export type CheckoutError = {
  kind: ErrorKind;
  message: string;
  code?: string;
};

const FR_MESSAGES: Record<ErrorKind, string> = {
  init_409: "Cette commande n'est plus payable.",
  "3ds_abandoned": "Authentification carte annulée. Vous pouvez réessayer.",
  card_declined: "Paiement refusé. Essayez une autre carte.",
  pi_invalid: "Cette commande n'est plus active.",
  network: "Erreur de connexion. Réessayez.",
  generic: "Le paiement a échoué.",
};

export function classifyStripeError(
  stripeError: StripeError | Error | unknown,
  httpStatus?: number,
): CheckoutError {
  if (httpStatus === 409) {
    return { kind: "init_409", message: FR_MESSAGES.init_409 };
  }

  if (stripeError instanceof TypeError) {
    return { kind: "network", message: FR_MESSAGES.network };
  }

  if (stripeError && typeof stripeError === "object" && "code" in stripeError) {
    const code = String((stripeError as { code: string }).code);
    const stripeMessage = (stripeError as { message?: string }).message;

    if (code === "payment_intent_authentication_failure") {
      return {
        kind: "3ds_abandoned",
        message: FR_MESSAGES["3ds_abandoned"],
        code,
      };
    }
    if (
      code === "card_declined" ||
      code === "expired_card" ||
      code === "incorrect_cvc" ||
      code === "processing_error"
    ) {
      return {
        kind: "card_declined",
        message: stripeMessage ?? FR_MESSAGES.card_declined,
        code,
      };
    }
    if (code === "payment_intent_unexpected_state") {
      return { kind: "pi_invalid", message: FR_MESSAGES.pi_invalid, code };
    }
  }

  const fallbackMessage =
    stripeError && typeof stripeError === "object" && "message" in stripeError
      ? String((stripeError as { message: string }).message)
      : FR_MESSAGES.generic;
  return { kind: "generic", message: fallbackMessage };
}

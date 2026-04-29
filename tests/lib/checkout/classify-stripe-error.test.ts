import { describe, it, expect } from "vitest";
import { classifyStripeError } from "@/lib/checkout/classify-stripe-error";

// T-407 — couverture des 6 ErrorKind du discriminé CheckoutError. Les
// fixtures Stripe émulent la shape réelle (code + message) sans dépendre
// de typages externes côté tests (cohérence avec les tests existants
// `tests/lib/stripe/*` qui mockent les types Stripe à plat).

describe("classifyStripeError — 3DS abandoned", () => {
  it("code payment_intent_authentication_failure → kind 3ds_abandoned", () => {
    const err = {
      code: "payment_intent_authentication_failure",
      message: "Stripe message original (ignoré)",
      type: "card_error",
    };
    const out = classifyStripeError(err);
    expect(out.kind).toBe("3ds_abandoned");
    expect(out.code).toBe("payment_intent_authentication_failure");
    expect(out.message).toBe(
      "Authentification carte annulée. Vous pouvez réessayer.",
    );
  });
});

describe("classifyStripeError — card_declined family", () => {
  it("code card_declined → kind card_declined + message Stripe préservé", () => {
    const err = {
      code: "card_declined",
      message: "Votre carte a été refusée.",
      type: "card_error",
    };
    const out = classifyStripeError(err);
    expect(out.kind).toBe("card_declined");
    expect(out.code).toBe("card_declined");
    expect(out.message).toBe("Votre carte a été refusée.");
  });

  it("code expired_card → kind card_declined", () => {
    const err = { code: "expired_card", message: "Carte expirée." };
    const out = classifyStripeError(err);
    expect(out.kind).toBe("card_declined");
    expect(out.code).toBe("expired_card");
  });

  it("code processing_error → kind card_declined", () => {
    const err = { code: "processing_error", message: "Erreur traitement." };
    const out = classifyStripeError(err);
    expect(out.kind).toBe("card_declined");
    expect(out.code).toBe("processing_error");
  });
});

describe("classifyStripeError — pi_invalid", () => {
  it("code payment_intent_unexpected_state → kind pi_invalid", () => {
    const err = {
      code: "payment_intent_unexpected_state",
      message: "PI is in canceled state.",
    };
    const out = classifyStripeError(err);
    expect(out.kind).toBe("pi_invalid");
    expect(out.code).toBe("payment_intent_unexpected_state");
    expect(out.message).toBe("Cette commande n'est plus active.");
  });
});

describe("classifyStripeError — network", () => {
  it("TypeError fetch → kind network", () => {
    const err = new TypeError("Failed to fetch");
    const out = classifyStripeError(err);
    expect(out.kind).toBe("network");
    expect(out.message).toBe("Erreur de connexion. Réessayez.");
  });
});

describe("classifyStripeError — generic fallback", () => {
  it("Stripe error sans code reconnu → kind generic + message Stripe préservé", () => {
    const err = {
      code: "some_unknown_stripe_code",
      message: "Erreur Stripe inattendue.",
    };
    const out = classifyStripeError(err);
    expect(out.kind).toBe("generic");
    expect(out.message).toBe("Erreur Stripe inattendue.");
  });
});

describe("classifyStripeError — init_409", () => {
  it("httpStatus 409 → kind init_409 (override toute autre détection)", () => {
    const out = classifyStripeError(undefined, 409);
    expect(out.kind).toBe("init_409");
    expect(out.message).toBe("Cette commande n'est plus payable.");
  });
});

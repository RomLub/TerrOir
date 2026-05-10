import Stripe from "stripe";

const stripeSecret = process.env.STRIPE_SECRET_KEY;

if (!stripeSecret) {
  throw new Error("Missing STRIPE_SECRET_KEY env variable");
}

// Garde-fou bascule Test → Live (F-018, audit pré-launch 2026-05-10).
// Empêche un déploiement Production qui chargerait par erreur sk_test_*
// (mauvais env Vercel, branche Preview promue Production) de partir
// silencieusement contre la prod. Webhook Live arriverait avec signature
// mismatch, mais des PI test pourraient être créés en parallèle sans
// alerte.
//
// STRIPE_EXPECTED_MODE override pour preview branches qui veulent forcer
// un mode explicite ('test' | 'live'). Si non défini, on déduit depuis
// VERCEL_ENV (production -> 'live', autre -> aucun check).
const expectedMode = (() => {
  const override = process.env.STRIPE_EXPECTED_MODE;
  if (override === "test" || override === "live") return override;
  if (process.env.VERCEL_ENV === "production") return "live";
  return null;
})();

if (expectedMode === "live" && !stripeSecret.startsWith("sk_live_")) {
  throw new Error(
    "[STRIPE_LIVEMODE_MISMATCH] Production must use sk_live_* — got non-live key. Set STRIPE_EXPECTED_MODE=test to bypass on preview branches.",
  );
}

if (expectedMode === "test" && !stripeSecret.startsWith("sk_test_")) {
  throw new Error(
    "[STRIPE_LIVEMODE_MISMATCH] STRIPE_EXPECTED_MODE=test set but STRIPE_SECRET_KEY is not sk_test_*.",
  );
}

export const stripe = new Stripe(stripeSecret, {
  apiVersion: "2026-04-22.dahlia",
  typescript: true,
});

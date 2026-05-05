import Stripe from "stripe";

const stripeSecret = process.env.STRIPE_SECRET_KEY;

if (!stripeSecret) {
  throw new Error("Missing STRIPE_SECRET_KEY env variable");
}

export const stripe = new Stripe(stripeSecret, {
  apiVersion: "2026-04-22.dahlia",
  typescript: true,
});

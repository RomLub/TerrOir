// Audit Stripe phase B (2026-05-05) L-1 : IP allowlist webhook Stripe en
// défense en profondeur derrière la signature HMAC. La signature suffit en
// théorie, mais la liste d'IP rejette les requêtes hors infrastructure
// Stripe AVANT d'évaluer le HMAC — économise du compute Vercel et coupe
// le bruit `[STRIPE_WEBHOOK_INVALID_SIGNATURE]` sur les scans / floods.
//
// Source : https://docs.stripe.com/ips ("Webhook notifications" — 15 IPv4
// individuelles, pas de CIDR ni IPv6 documenté). À re-synchroniser
// manuellement si Stripe ajoute des IPs (cf. docs/conventions/
// stripe-webhook.md). Stripe expose également un endpoint plat
// https://stripe.com/files/ips/ips_webhooks.txt pour automatisation future.
export const STRIPE_WEBHOOK_IPS: ReadonlySet<string> = new Set([
  "3.18.12.63",
  "3.130.192.231",
  "13.235.14.237",
  "13.235.122.149",
  "18.211.135.69",
  "35.154.171.200",
  "52.15.183.38",
  "54.88.130.119",
  "54.88.130.237",
  "54.187.174.169",
  "54.187.205.235",
  "54.187.216.72",
  "35.157.207.129",
  "3.69.109.8",
  "3.120.168.93",
]);

// Vrai si l'IP fait partie de la liste Stripe officielle. Bypass en dev /
// preview / CI / tests pour permettre `stripe listen --forward-to ...` et
// les rejouages locaux. La gate prod-only est intentionnelle : on
// n'enforce qu'en production Vercel pour ne pas casser les flows test.
export function isStripeWebhookIp(ip: string | null): boolean {
  if (process.env.VERCEL_ENV !== "production") return true;
  if (!ip) return false;
  return STRIPE_WEBHOOK_IPS.has(ip);
}

// Extrait l'IP cliente depuis les headers Vercel. Aligné sur le pattern
// lib/audit-logs/log-auth-event.ts:158-167 (1re entrée du CSV
// x-forwarded-for, fallback x-real-ip). Vercel ajoute son propre proxy en
// queue, donc l'IP de l'émetteur (Stripe) est en tête.
export function extractWebhookClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? null;
}

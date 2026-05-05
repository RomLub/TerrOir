// Vitest pour lib/stripe/ip-allowlist.ts (Audit Stripe phase B L-1).
// Couverture : Set IP officielle, bypass non-production, miss en production,
// extraction IP depuis Headers (CSV x-forwarded-for + fallback x-real-ip).

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  STRIPE_WEBHOOK_IPS,
  extractWebhookClientIp,
  isStripeWebhookIp,
} from "@/lib/stripe/ip-allowlist";

describe("STRIPE_WEBHOOK_IPS — liste source", () => {
  it("contient les 15 IPs officielles documentées sur stripe.com/ips", () => {
    // Snapshot intentionnel : si la liste change, on veut que le test casse
    // pour forcer un refresh manuel (cf. docs/conventions/stripe-webhook.md).
    expect(STRIPE_WEBHOOK_IPS.size).toBe(15);
    expect(STRIPE_WEBHOOK_IPS.has("3.18.12.63")).toBe(true);
    expect(STRIPE_WEBHOOK_IPS.has("54.187.216.72")).toBe(true);
    expect(STRIPE_WEBHOOK_IPS.has("3.120.168.93")).toBe(true);
  });
});

describe("isStripeWebhookIp — gate environnement", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalEnv;
  });

  it("production + IP Stripe valide → true", () => {
    process.env.VERCEL_ENV = "production";
    expect(isStripeWebhookIp("3.18.12.63")).toBe(true);
  });

  it("production + IP non-Stripe → false", () => {
    process.env.VERCEL_ENV = "production";
    expect(isStripeWebhookIp("203.0.113.10")).toBe(false);
  });

  it("production + IP null → false", () => {
    process.env.VERCEL_ENV = "production";
    expect(isStripeWebhookIp(null)).toBe(false);
  });

  it("preview Vercel + IP non-Stripe → true (bypass)", () => {
    process.env.VERCEL_ENV = "preview";
    expect(isStripeWebhookIp("203.0.113.10")).toBe(true);
  });

  it("development Vercel + IP null → true (bypass dev local)", () => {
    process.env.VERCEL_ENV = "development";
    expect(isStripeWebhookIp(null)).toBe(true);
  });

  it("VERCEL_ENV undefined (local next dev) + IP null → true (bypass)", () => {
    delete process.env.VERCEL_ENV;
    expect(isStripeWebhookIp(null)).toBe(true);
  });
});

describe("extractWebhookClientIp — parsing headers", () => {
  it("retourne la 1re IP du CSV x-forwarded-for (Vercel: client, proxy1)", () => {
    const headers = new Headers({
      "x-forwarded-for": "3.18.12.63, 10.0.0.1, 192.168.1.1",
    });
    expect(extractWebhookClientIp(headers)).toBe("3.18.12.63");
  });

  it("trim les espaces autour de l'IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "  3.18.12.63  , 10.0.0.1",
    });
    expect(extractWebhookClientIp(headers)).toBe("3.18.12.63");
  });

  it("fallback x-real-ip si x-forwarded-for absent", () => {
    const headers = new Headers({ "x-real-ip": "54.187.216.72" });
    expect(extractWebhookClientIp(headers)).toBe("54.187.216.72");
  });

  it("retourne null si aucun header IP", () => {
    const headers = new Headers();
    expect(extractWebhookClientIp(headers)).toBeNull();
  });

  it("x-forwarded-for vide → fallback x-real-ip", () => {
    const headers = new Headers({
      "x-forwarded-for": "",
      "x-real-ip": "54.187.216.72",
    });
    expect(extractWebhookClientIp(headers)).toBe("54.187.216.72");
  });
});

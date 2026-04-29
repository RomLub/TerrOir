import { describe, it, expect, vi } from "vitest";

// lib/env/urls.ts fail-fast au load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_PRODUCER_URL ne sont pas définis. Pattern hoisted pour set
// les vars AVANT l'évaluation des imports (cf. tests/components/ui/
// role-toggle.test.ts).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

import { getRoleSwitcherUrls } from "@/lib/auth/role-switcher-urls";

describe("getRoleSwitcherUrls — gating + URLs cross-subdomain", () => {
  it("aucun rôle → show=false", () => {
    const result = getRoleSwitcherUrls([]);
    expect(result.show).toBe(false);
  });

  it("consumer seul → show=false (pas besoin switcher)", () => {
    const result = getRoleSwitcherUrls(["consumer"]);
    expect(result.show).toBe(false);
  });

  it("producer seul → show=false (pas besoin switcher)", () => {
    const result = getRoleSwitcherUrls(["producer"]);
    expect(result.show).toBe(false);
  });

  it("consumer + producer → show=true", () => {
    const result = getRoleSwitcherUrls(["consumer", "producer"]);
    expect(result.show).toBe(true);
  });

  it("ordre indifférent (producer + consumer) → show=true", () => {
    const result = getRoleSwitcherUrls(["producer", "consumer"]);
    expect(result.show).toBe(true);
  });

  it("rôles supplémentaires non listés → show=true tant que les deux sont présents", () => {
    // Défense future si un nouveau rôle apparaît côté DB (ex: 'beta-tester').
    // Le helper se concentre uniquement sur consumer/producer.
    const result = getRoleSwitcherUrls(["consumer", "producer", "extra"]);
    expect(result.show).toBe(true);
  });

  it("consumerUrl est absolu et termine par /compte", () => {
    const { consumerUrl } = getRoleSwitcherUrls(["consumer", "producer"]);
    expect(consumerUrl).toMatch(/^https?:\/\//);
    expect(consumerUrl).toMatch(/\/compte$/);
  });

  it("producerUrl est absolu et termine par /dashboard", () => {
    const { producerUrl } = getRoleSwitcherUrls(["consumer", "producer"]);
    expect(producerUrl).toMatch(/^https?:\/\//);
    expect(producerUrl).toMatch(/\/dashboard$/);
  });

  it("URLs consumer/producer ciblent des hosts différents (cross-subdomain)", () => {
    const { consumerUrl, producerUrl } = getRoleSwitcherUrls([
      "consumer",
      "producer",
    ]);
    expect(new URL(consumerUrl).host).not.toBe(new URL(producerUrl).host);
  });

  it("URLs sont retournées même quand show=false (pas de gating sur les URLs)", () => {
    // Gating et URLs sont indépendants : le composant décide d'afficher ou
    // pas. Les URLs restent stables, prêtes à l'emploi.
    const result = getRoleSwitcherUrls([]);
    expect(result.consumerUrl).toMatch(/\/compte$/);
    expect(result.producerUrl).toMatch(/\/dashboard$/);
  });
});

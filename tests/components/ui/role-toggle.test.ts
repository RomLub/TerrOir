import { describe, it, expect, vi } from "vitest";

// Le module @/lib/env/urls fail-fast au load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_PRODUCER_URL ne sont pas définis. Pattern hoisted pour set
// les vars AVANT l'évaluation des imports (cf. tests/app/api/stock-alerts/
// route.test.ts).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
});

import {
  RoleToggle,
  ROLE_TOGGLE_LABEL_CONSUMER,
  ROLE_TOGGLE_LABEL_PRODUCER,
  getRoleToggleTargetUrl,
} from "@/components/ui/role-toggle";

// Tests data-invariant uniquement — le repo n'a pas de setup React Testing
// Library (vitest env=node, pas jsdom, pas de .test.tsx). On valide les
// invariants critiques exposés comme constantes + fonction pure : labels
// a11y et résolution URL absolue cross-subdomain. Pattern conforme
// password-input.test.ts et circuit-visualizer.test.ts.

describe("RoleToggle — invariants labels a11y + URL cible", () => {
  it("exporte le composant RoleToggle", () => {
    expect(RoleToggle).toBeDefined();
  });

  it("ROLE_TOGGLE_LABEL_CONSUMER mentionne 'acheteur' (cohérent footer 'Acheter')", () => {
    expect(typeof ROLE_TOGGLE_LABEL_CONSUMER).toBe("string");
    expect(ROLE_TOGGLE_LABEL_CONSUMER.length).toBeGreaterThan(0);
    expect(ROLE_TOGGLE_LABEL_CONSUMER).toMatch(/acheteur/i);
  });

  it("ROLE_TOGGLE_LABEL_PRODUCER mentionne 'producteur'", () => {
    expect(typeof ROLE_TOGGLE_LABEL_PRODUCER).toBe("string");
    expect(ROLE_TOGGLE_LABEL_PRODUCER.length).toBeGreaterThan(0);
    expect(ROLE_TOGGLE_LABEL_PRODUCER).toMatch(/producteur/i);
  });

  it("labels consumer/producer distincts (discriminant a11y critique)", () => {
    expect(ROLE_TOGGLE_LABEL_CONSUMER).not.toBe(ROLE_TOGGLE_LABEL_PRODUCER);
  });

  it("getRoleToggleTargetUrl('consumer') retourne URL absolue terminant sur /compte", () => {
    const url = getRoleToggleTargetUrl("consumer");
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toMatch(/\/compte$/);
  });

  it("getRoleToggleTargetUrl('producer') retourne URL absolue terminant sur /dashboard", () => {
    const url = getRoleToggleTargetUrl("producer");
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toMatch(/\/dashboard$/);
  });

  it("URLs consumer/producer ciblent des hosts différents (cross-subdomain)", () => {
    const consumerUrl = new URL(getRoleToggleTargetUrl("consumer"));
    const producerUrl = new URL(getRoleToggleTargetUrl("producer"));
    expect(consumerUrl.host).not.toBe(producerUrl.host);
  });
});

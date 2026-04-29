import { describe, it, expect, vi } from "vitest";

// lib/env/urls.ts (chargé transitivement via le helper role-switcher-urls)
// fail-fast au load si NEXT_PUBLIC_APP_URL ou NEXT_PUBLIC_PRODUCER_URL ne
// sont pas définis. Pattern hoisted pour set les vars AVANT l'évaluation
// des imports.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

import {
  RoleToggle,
  ROLE_TOGGLE_LABEL_CONSUMER,
  ROLE_TOGGLE_LABEL_PRODUCER,
} from "@/components/ui/role-toggle";

// Tests data-invariant uniquement — le repo n'a pas de setup React Testing
// Library (vitest env=node, pas jsdom, pas de .test.tsx). On valide les
// invariants critiques exposés comme constantes : labels a11y. La logique
// gating + URLs est désormais factorisée dans
// lib/auth/role-switcher-urls.ts (testée séparément).

describe("RoleToggle — invariants labels a11y", () => {
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
});

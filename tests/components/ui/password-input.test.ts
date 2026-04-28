import { describe, it, expect } from "vitest";
import {
  PasswordInput,
  PASSWORD_TOGGLE_LABEL_HIDE,
  PASSWORD_TOGGLE_LABEL_SHOW,
  getPasswordToggleLabel,
} from "@/components/ui/password-input";

// Tests data-invariant uniquement — le repo n'a pas de setup React Testing
// Library (vitest env=node, pas de jsdom, pas de .test.tsx). On valide les
// invariants critiques de la logique toggle exposée comme fonction pure +
// labels a11y exportés, conforme pattern circuit-visualizer.test.ts.

describe("PasswordInput — invariants labels a11y + toggle pur", () => {
  it("exporte le composant PasswordInput", () => {
    expect(PasswordInput).toBeDefined();
  });

  it("PASSWORD_TOGGLE_LABEL_SHOW est défini, non vide, en français", () => {
    expect(typeof PASSWORD_TOGGLE_LABEL_SHOW).toBe("string");
    expect(PASSWORD_TOGGLE_LABEL_SHOW.length).toBeGreaterThan(0);
    expect(PASSWORD_TOGGLE_LABEL_SHOW).toMatch(/Afficher/i);
  });

  it("PASSWORD_TOGGLE_LABEL_HIDE est défini, non vide, en français", () => {
    expect(typeof PASSWORD_TOGGLE_LABEL_HIDE).toBe("string");
    expect(PASSWORD_TOGGLE_LABEL_HIDE.length).toBeGreaterThan(0);
    expect(PASSWORD_TOGGLE_LABEL_HIDE).toMatch(/Masquer/i);
  });

  it("labels show/hide sont distincts (discriminant a11y critique)", () => {
    expect(PASSWORD_TOGGLE_LABEL_SHOW).not.toBe(PASSWORD_TOGGLE_LABEL_HIDE);
  });

  it("getPasswordToggleLabel(false) → SHOW (état initial : password masqué, action = afficher)", () => {
    expect(getPasswordToggleLabel(false)).toBe(PASSWORD_TOGGLE_LABEL_SHOW);
  });

  it("getPasswordToggleLabel(true) → HIDE (toggle activé : password visible, action = masquer)", () => {
    expect(getPasswordToggleLabel(true)).toBe(PASSWORD_TOGGLE_LABEL_HIDE);
  });
});

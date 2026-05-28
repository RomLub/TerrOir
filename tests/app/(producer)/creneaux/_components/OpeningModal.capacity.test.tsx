// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

// Test du feedback dynamique "Maximum X places pour cette durée" dans
// OpeningModal. Couvre les paliers métier et l'état d'alerte quand la
// capacité saisie dépasse le max autorisé.

vi.mock("@/app/(producer)/creneaux/actions", () => ({
  createSlotRuleAction: vi.fn(),
  updateSlotRuleAction: vi.fn(),
  createAdHocSlotAction: vi.fn(),
}));

import OpeningModal from "@/app/(producer)/creneaux/_components/OpeningModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactElement) {
  act(() => root.render(node));
}

function hint(): HTMLElement {
  const el = container.querySelector(
    '[data-testid="capacity-hint"]',
  ) as HTMLElement | null;
  if (!el) throw new Error("capacity-hint not found");
  return el;
}

function capacityInput(): HTMLInputElement {
  return container.querySelector(
    '[data-testid="capacity-input"]',
  ) as HTMLInputElement;
}

// React contrôle la value via son propre tracker. Pour que onChange voie
// un changement en jsdom, on doit passer par le setter natif puis
// dispatcher un event "input" bubbling. Pattern référence repo.
function setCapacity(n: number) {
  const input = capacityInput();
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeSetter.call(input, String(n));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setMode(target: "libre" | "rdv") {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-pressed") !== null && b.textContent?.includes(
      target === "libre" ? "Ouverture libre" : "Sur rendez-vous",
    ),
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`mode button ${target} not found`);
  act(() => btn.click());
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeSetter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("OpeningModal — feedback capacité", () => {
  it("mode libre 9h-12h → hint affiche 'Maximum 24 pour 180 min'", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    setMode("libre");
    expect(hint().textContent).toContain("24");
    expect(hint().textContent).toContain("180 min");
  });

  it("mode rdv 30min → hint affiche 'Maximum 4 pour 30 min'", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    setMode("rdv");
    // 30 min est la valeur par défaut du select.
    expect(hint().textContent).toContain("Maximum 4");
    expect(hint().textContent).toContain("30 min");
  });

  it("capacité au-dessus de max → hint passe en mode alerte (couleur terra)", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    setMode("rdv");
    setCapacity(10); // max=4 sur rdv 30min
    const h = hint();
    expect(h.className).toContain("terra-700");
    expect(h.textContent).toContain("2 places par quart");
  });

  it("capacité au-dessus → bouton Enregistrer désactivé", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    setMode("rdv");
    setCapacity(10);
    const save = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Enregistrer",
    ) as HTMLButtonElement | undefined;
    expect(save).toBeDefined();
    expect(save!.disabled).toBe(true);
  });

  it("capacité dans la limite → bouton Enregistrer activé (avec jours sélectionnés)", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    setMode("rdv");
    setCapacity(4);
    const save = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Enregistrer",
    ) as HTMLButtonElement | undefined;
    expect(save).toBeDefined();
    expect(save!.disabled).toBe(false);
  });

  it("input number porte max={maxCap} (HTML clamp)", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    setMode("rdv");
    const input = capacityInput();
    expect(input.getAttribute("max")).toBe("4");
  });

  it("valeur par défaut respecte le max pour les modes par défaut (libre 9-12 ET rdv 30min)", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    // libre 9-12 (amplitude 180min, maxCap=24) : default doit être ≤ 24.
    const initialValue = parseInt(capacityInput().value, 10);
    expect(initialValue).toBeGreaterThanOrEqual(1);
    expect(initialValue).toBeLessThanOrEqual(24);

    // rdv 30min (maxCap=4) : default doit être ≤ 4 (sans saisie manuelle).
    setMode("rdv");
    const rdvValue = parseInt(capacityInput().value, 10);
    expect(rdvValue).toBeGreaterThanOrEqual(1);
    expect(rdvValue).toBeLessThanOrEqual(4);
  });

  it("auto-clamp — switch libre → rdv avec capacité > nouveau max ramène au max", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    // libre 9-12 → maxCap=24, on monte à 20.
    setCapacity(20);
    expect(parseInt(capacityInput().value, 10)).toBe(20);
    // switch en rdv 30min → maxCap=4, capacité doit être clampée à 4.
    setMode("rdv");
    expect(parseInt(capacityInput().value, 10)).toBe(4);
  });

  it("auto-clamp — réduction de la durée rdv (30 → 15) ramène la capacité au nouveau max", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    setMode("rdv");
    setCapacity(4); // OK pour 30min (max=4)
    // Passer à 15 min via le select des durées (1er <select> du formulaire).
    const select = container.querySelector("select") as HTMLSelectElement;
    if (!select) throw new Error("duration select not found");
    setSelectValue(select, "15");
    // 15min → maxCap=2, capacity=4 doit être clampée à 2.
    expect(parseInt(capacityInput().value, 10)).toBe(2);
  });

  it("auto-clamp — pas de clamp à la saisie manuelle au-dessus du max (alerte seule)", () => {
    render(<OpeningModal onClose={() => {}} onSuccess={() => {}} />);
    setMode("rdv"); // maxCap=4
    setCapacity(10); // saisie manuelle au-dessus
    // La saisie manuelle reste affichée : on signale l'erreur sans corriger
    // silencieusement (l'utilisateur garde la main).
    expect(parseInt(capacityInput().value, 10)).toBe(10);
    expect(hint().className).toContain("terra-700");
  });
});

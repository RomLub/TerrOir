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
});

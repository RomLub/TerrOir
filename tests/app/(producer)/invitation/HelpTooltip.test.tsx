// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpTooltip } from "@/app/(producer)/invitation/_components/HelpTooltip";

// =============================================================================
// T-241 r4 — HelpTooltip
// =============================================================================
// Verrouille le pattern Disclosure attendu :
//   - panneau caché par défaut (aria-expanded=false)
//   - clic trigger → panneau visible (role=tooltip, aria-expanded=true)
//   - clic en dehors → panneau caché
//   - touche Escape → panneau caché
//   - aria-controls relie trigger ↔ panneau (id stable)
// =============================================================================

afterEach(() => {
  cleanup();
});

function renderTooltip() {
  return render(
    <div>
      <HelpTooltip
        id="tip-mode-elevage"
        ariaLabel="Aide : mode d'élevage"
      >
        Choisis l&rsquo;option qui décrit le mieux la conduite habituelle de
        tes animaux.
      </HelpTooltip>
      <button type="button">Outside button</button>
    </div>,
  );
}

describe("HelpTooltip — pattern Disclosure", () => {
  it("rendu initial : trigger présent, panneau caché", () => {
    renderTooltip();
    const trigger = screen.getByRole("button", {
      name: /Aide : mode/,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe("tip-mode-elevage");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("clic trigger : ouvre le panneau (role=tooltip + aria-expanded=true)", async () => {
    const user = userEvent.setup();
    renderTooltip();
    const trigger = screen.getByRole("button", {
      name: /Aide : mode/,
    });
    await user.click(trigger);
    const panel = screen.getByRole("tooltip");
    expect(panel).toBeTruthy();
    expect(panel.id).toBe("tip-mode-elevage");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("clic en dehors : referme le panneau", async () => {
    const user = userEvent.setup();
    renderTooltip();
    const trigger = screen.getByRole("button", {
      name: /Aide : mode/,
    });
    await user.click(trigger);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    // Clic sur un bouton extérieur — le pointerdown global doit catch.
    await user.click(screen.getByRole("button", { name: "Outside button" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("touche Escape : referme le panneau", async () => {
    const user = userEvent.setup();
    renderTooltip();
    const trigger = screen.getByRole("button", {
      name: /Aide : mode/,
    });
    await user.click(trigger);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("clic dans le panneau : ne le referme pas (contenu informatif)", async () => {
    const user = userEvent.setup();
    renderTooltip();
    const trigger = screen.getByRole("button", {
      name: /Aide : mode/,
    });
    await user.click(trigger);
    const panel = screen.getByRole("tooltip");
    await user.click(panel);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("clic trigger une 2e fois : referme le panneau (toggle)", async () => {
    const user = userEvent.setup();
    renderTooltip();
    const trigger = screen.getByRole("button", {
      name: /Aide : mode/,
    });
    await user.click(trigger);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    await user.click(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

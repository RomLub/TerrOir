// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { CommuneSelect } from "@/components/ui/commune-select";

// Couvre les comportements SYNCHRONES de CommuneSelect (points 1 et 3 de la
// demande). L'autocomplétion CP (point 2, async/debounced) est couverte au
// niveau lib (fetchCommuneSuggestions) + route (/api/public/communes/suggest).

beforeEach(() => {
  // fetch global stubé : les effets (communes / suggestions) peuvent partir
  // sans casser les assertions synchrones.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, communes: ["Le Mans"], suggestions: [] }),
    })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommuneSelect", () => {
  it("commune grisée (lecture seule) tant qu'aucun code postal valide", () => {
    render(<CommuneSelect />);
    const commune = screen.getByLabelText("Commune") as HTMLInputElement;
    expect(commune.readOnly).toBe(true);
    expect(commune.placeholder.toLowerCase()).toContain("code postal");
  });

  it("effacer le code postal vide la commune (point 3)", () => {
    const onCommune = vi.fn();
    render(
      <CommuneSelect
        defaultCodePostal="72000"
        defaultCommune="Le Mans"
        onCommuneChange={onCommune}
      />,
    );
    const cp = screen.getByLabelText("Code postal");
    fireEvent.change(cp, { target: { value: "7200" } });
    expect(onCommune).toHaveBeenLastCalledWith("");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Perf (latence-navigation 2026-05-24) — gate client de la bannière
// "Compte supprimé". Avant, la home lisait ?compte-supprime=1 en Server
// Component (await searchParams), ce qui forçait un rendu dynamique et bloquait
// le prefetch. Le flag est désormais lu côté client via useSearchParams. Ce
// test verrouille le contrat : la bannière n'apparaît QUE pour la valeur exacte
// "1", et reste invisible (DOM propre) dans tous les autres cas.

// useSearchParams est piloté par ce mock : chaque test règle la valeur du param.
let currentParam: string | null = null;
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "compte-supprime" ? currentParam : null),
  }),
}));

import { AccountDeletedBannerGate } from "@/app/(public)/_components/home/AccountDeletedBannerGate";

afterEach(() => {
  cleanup();
  currentParam = null;
});

describe("AccountDeletedBannerGate", () => {
  it("affiche la bannière quand ?compte-supprime=1", () => {
    currentParam = "1";
    render(<AccountDeletedBannerGate />);
    expect(
      screen.getByRole("heading", { name: /Compte supprimé/i }),
    ).toBeTruthy();
  });

  it("n'affiche rien quand le param est absent", () => {
    currentParam = null;
    const { container } = render(<AccountDeletedBannerGate />);
    expect(screen.queryByRole("heading", { name: /Compte supprimé/i })).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("n'affiche rien pour une valeur autre que \"1\"", () => {
    currentParam = "0";
    const { container } = render(<AccountDeletedBannerGate />);
    expect(screen.queryByRole("heading", { name: /Compte supprimé/i })).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

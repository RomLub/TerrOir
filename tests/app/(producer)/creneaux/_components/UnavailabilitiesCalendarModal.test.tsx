// @vitest-environment jsdom
// Tests d'intégration de la modale d'indispo (PR #2). Couvre les 5 états
// de cellule (créneaux, sélectionné, indispo posée, commandes actives,
// passé), la soumission, et le filet d'erreur BLOCKING_ORDERS.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/app/(producer)/creneaux/actions", () => ({
  createUnavailabilitiesAction: vi.fn(),
  deleteUnavailabilityAction: vi.fn(),
}));

vi.mock("@/app/(producer)/creneaux/_components/_month-calendar", async () => {
  const actual = await vi.importActual<
    typeof import("@/app/(producer)/creneaux/_components/_month-calendar")
  >("@/app/(producer)/creneaux/_components/_month-calendar");
  return {
    ...actual,
    // Fige "aujourd'hui" pour les tests : 2026-06-15 (lundi).
    todayParisKey: () => "2026-06-15",
  };
});

import {
  createUnavailabilitiesAction,
  deleteUnavailabilityAction,
} from "@/app/(producer)/creneaux/actions";
import UnavailabilitiesCalendarModal from "@/app/(producer)/creneaux/_components/UnavailabilitiesCalendarModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function findCell(container: HTMLElement, dateKey: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.getAttribute("aria-label") ?? "").startsWith(dateKey),
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`Cellule ${dateKey} introuvable`);
  return btn;
}

describe("<UnavailabilitiesCalendarModal>", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(createUnavailabilitiesAction).mockReset();
    vi.mocked(deleteUnavailabilityAction).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderModal(
    overrides: Partial<
      React.ComponentProps<typeof UnavailabilitiesCalendarModal>
    > = {},
  ): { onClose: ReturnType<typeof vi.fn>; onSuccess: ReturnType<typeof vi.fn> } {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    act(() =>
      root.render(
        <UnavailabilitiesCalendarModal
          unavailableDates={new Set()}
          datesWithSlots={new Set()}
          datesWithActiveOrders={new Set()}
          unavailabilityIdByDate={new Map()}
          onClose={onClose}
          onSuccess={onSuccess}
          {...overrides}
        />,
      ),
    );
    return { onClose, onSuccess };
  }

  it("jour passé non-cliquable (aria-label contient 'jour passé')", () => {
    renderModal();
    const cell = findCell(container, "2026-06-14"); // veille
    expect(cell.disabled).toBe(true);
    expect(cell.getAttribute("aria-label")).toContain("passé");
  });

  it("jour avec créneaux : marqueur visuel + sélectionnable", () => {
    renderModal({ datesWithSlots: new Set(["2026-06-16"]) });
    const cell = findCell(container, "2026-06-16");
    expect(cell.disabled).toBe(false);
    // Pas de label spécifique "créneaux" — marqueur est un dot. On vérifie
    // juste qu'il est cliquable et qu'aucun autre état ne le verrouille.
  });

  it("jour avec commandes actives : NON cliquable + aria-label explicite", () => {
    renderModal({ datesWithActiveOrders: new Set(["2026-06-17"]) });
    const cell = findCell(container, "2026-06-17");
    expect(cell.disabled).toBe(true);
    expect(cell.getAttribute("aria-label")).toContain("commandes actives");
  });

  it("clic sur jour normal → cellule sélectionnée + compteur affiché", async () => {
    renderModal();
    const cell = findCell(container, "2026-06-18");
    await act(async () => {
      cell.click();
      await flush();
    });
    expect(container.textContent).toContain("1 jour sélectionné");
  });

  it("clic sur jour déjà indispo → mini-confirmation 'Retirer / Annuler'", async () => {
    renderModal({
      unavailableDates: new Set(["2026-06-20"]),
      unavailabilityIdByDate: new Map([["2026-06-20", "u-1"]]),
    });
    const cell = findCell(container, "2026-06-20");
    expect(cell.getAttribute("aria-label")).toContain("retirer");
    await act(async () => {
      cell.click();
      await flush();
    });
    expect(container.textContent).toContain("Retirer");
  });

  it("CTA 'Poser indispo' disabled si 0 sélection", () => {
    renderModal();
    const cta = Array.from(container.querySelectorAll("button")).find((b) =>
      /Poser indispo/.test(b.textContent ?? ""),
    ) as HTMLButtonElement | undefined;
    expect(cta?.disabled).toBe(true);
  });

  it("soumission OK → onSuccess()", async () => {
    vi.mocked(createUnavailabilitiesAction).mockResolvedValue({
      success: true,
      created_count: 1,
    });
    const { onSuccess } = renderModal();

    const cell = findCell(container, "2026-06-18");
    await act(async () => {
      cell.click();
      await flush();
    });

    const cta = Array.from(container.querySelectorAll("button")).find((b) =>
      /Poser indispo/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    await act(async () => {
      cta.click();
      await flush();
      await flush();
    });

    expect(createUnavailabilitiesAction).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it("retour BLOCKING_ORDERS → message d'erreur explicite, pas onSuccess", async () => {
    vi.mocked(createUnavailabilitiesAction).mockResolvedValue({
      error: "Des commandes",
      code: "BLOCKING_ORDERS",
      blocking_orders: [
        {
          id: "o-1",
          numero_commande: "0042-00001",
          consumer_prenom: "Marie",
          montant_total: 25,
          slot_starts_at: "2026-06-18T07:00:00Z",
          slot_ends_at: "2026-06-18T07:30:00Z",
          date_key: "2026-06-18",
        },
      ],
    });
    const { onSuccess } = renderModal();

    const cell = findCell(container, "2026-06-18");
    await act(async () => {
      cell.click();
      await flush();
    });
    const cta = Array.from(container.querySelectorAll("button")).find((b) =>
      /Poser indispo/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    await act(async () => {
      cta.click();
      await flush();
      await flush();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(
      /commandes actives bloquent.*Annulez-les depuis/i,
    );
    expect(container.textContent).toContain("2026-06-18");
  });

  it("confirmation suppression d'indispo → deleteUnavailabilityAction(id) appelé", async () => {
    vi.mocked(deleteUnavailabilityAction).mockResolvedValue({
      success: true,
      regenerated_slots: 6,
    });
    const { onSuccess } = renderModal({
      unavailableDates: new Set(["2026-06-20"]),
      unavailabilityIdByDate: new Map([["2026-06-20", "u-1"]]),
    });

    const cell = findCell(container, "2026-06-20");
    await act(async () => {
      cell.click();
      await flush();
    });

    const retirer = Array.from(container.querySelectorAll("button")).find((b) =>
      /^Retirer$/.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
    await act(async () => {
      retirer.click();
      await flush();
      await flush();
    });

    expect(deleteUnavailabilityAction).toHaveBeenCalledWith("u-1");
    expect(onSuccess).toHaveBeenCalled();
  });
});

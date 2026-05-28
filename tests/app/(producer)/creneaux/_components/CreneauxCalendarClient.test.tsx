// @vitest-environment jsdom
// Test d'intégration #11 du chantier "Annuler et fermer" : on vérifie que
// quand une action exclude retourne blocking_orders, la modale
// CancelAndCloseModal s'ouvre côté CreneauxCalendarClient avec la liste
// reçue. C'est le point d'intégration critique action serveur → composant
// client.

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
import type { ReactElement } from "react";

import type {
  BlockingOrder,
  ExcludeActionResult,
} from "@/app/(producer)/creneaux/actions";
import type { CalendarDay, CalendarBlock } from "@/lib/slots/group-week-slots";
import type { SlotRuleRow } from "@/lib/slots/validators";

vi.mock("@/app/(producer)/creneaux/actions", () => ({
  deleteSlotRuleAction: vi.fn(),
  deleteAdHocOpeningAction: vi.fn(),
  excludeSlotsByIdsAction: vi.fn(),
  unexcludeSlotsByIdsAction: vi.fn(),
  bulkExcludeRangeAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/creneaux",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/(producer)/_components/WeekNavigator", () => ({
  WeekNavigator: () => null,
}));

vi.mock("@/app/(producer)/creneaux/_components/OpeningModal", () => ({
  default: () => null,
}));

import { excludeSlotsByIdsAction } from "@/app/(producer)/creneaux/actions";
import CreneauxCalendarClient from "@/app/(producer)/creneaux/_components/CreneauxCalendarClient";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(excludeSlotsByIdsAction).mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactElement) {
  act(() => root.render(node));
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buildBlock(over: Partial<CalendarBlock> = {}): CalendarBlock {
  return {
    key: "block-1",
    kind: "oneoff",
    ruleId: null,
    label: "10h–10h30",
    mode: "rdv",
    capacity: 1,
    slotCount: 2,
    slotIds: ["slot-A", "slot-B"],
    excluded: false,
    hasActiveOrder: true,
    sortKey: 0,
    ...over,
  };
}

function buildDays(): CalendarDay[] {
  // Seul le 1er jour porte le bloc cliquable — c'est ce que les tests
  // touchent. Les 6 autres sont des cellules vides (dateKey unique) pour
  // satisfaire la grille semaine sans dupliquer les clés React.
  const dayWithBlock: CalendarDay = {
    dateKey: "2026-05-25",
    weekdayLabel: "lun.",
    dayNum: "25",
    isToday: false,
    blocks: [buildBlock()],
  } as unknown as CalendarDay;
  const emptyDay = (date: string, num: string, weekday: string): CalendarDay =>
    ({
      dateKey: date,
      weekdayLabel: weekday,
      dayNum: num,
      isToday: false,
      blocks: [],
    }) as unknown as CalendarDay;
  return [
    dayWithBlock,
    emptyDay("2026-05-26", "26", "mar."),
    emptyDay("2026-05-27", "27", "mer."),
    emptyDay("2026-05-28", "28", "jeu."),
    emptyDay("2026-05-29", "29", "ven."),
    emptyDay("2026-05-30", "30", "sam."),
    emptyDay("2026-05-31", "31", "dim."),
  ];
}

const RULES: SlotRuleRow[] = [];

function makeOrder(over: Partial<BlockingOrder> = {}): BlockingOrder {
  return {
    id: "order-1",
    code_commande: "X-001",
    consumer_prenom: "Marie",
    montant_total: 28.5,
    slot_starts_at: "2026-05-30T08:00:00Z",
    slot_ends_at: "2026-05-30T08:15:00Z",
    ...over,
  };
}

function clickBlockThenClose() {
  // Trouve le 1er bouton qui contient "10h–10h30" (le bloc), click pour
  // ouvrir le menu contextuel.
  const blockBtn = Array.from(
    container.querySelectorAll("button"),
  ).find((b) => (b.textContent ?? "").includes("10h–10h30")) as
    | HTMLButtonElement
    | undefined;
  if (!blockBtn) throw new Error("Bloc créneau non trouvé");
  act(() => blockBtn.click());

  // Puis trouve le bouton "Fermer ce jour" du BlockMenu.
  const closeBtn = Array.from(
    container.querySelectorAll("button"),
  ).find((b) => /Fermer ce jour/i.test(b.textContent ?? "")) as
    | HTMLButtonElement
    | undefined;
  if (!closeBtn) throw new Error("Bouton 'Fermer ce jour' non trouvé");
  act(() => closeBtn.click());
}

describe("CreneauxCalendarClient — intégration modale Annuler et fermer (#11)", () => {
  it("action exclude retourne blocking_orders → modale s'ouvre avec la liste reçue", async () => {
    const blockingOrders = [
      makeOrder({ id: "o1", consumer_prenom: "Marie" }),
      makeOrder({ id: "o2", consumer_prenom: "Paul" }),
    ];
    vi.mocked(excludeSlotsByIdsAction).mockResolvedValue({
      error: "Une commande active est liée à cette ouverture.",
      blocking_orders: blockingOrders,
    } satisfies ExcludeActionResult);

    render(
      <CreneauxCalendarClient
        weekOffset={0}
        periodLabel="25 – 31 mai"
        days={buildDays()}
        rules={RULES}
      />,
    );

    // Pas de modale au départ.
    expect(
      container.querySelector('[data-testid="cancel-and-close-modal"]'),
    ).toBeNull();

    clickBlockThenClose();
    await flushPromises();

    // Action invoquée avec les bons slotIds.
    expect(excludeSlotsByIdsAction).toHaveBeenCalledTimes(1);
    expect(excludeSlotsByIdsAction).toHaveBeenCalledWith(["slot-A", "slot-B"]);

    // La modale est ouverte avec les 2 orders propagés.
    const modal = container.querySelector(
      '[data-testid="cancel-and-close-modal"]',
    );
    expect(modal).not.toBeNull();
    const rows = container.querySelectorAll(
      '[data-testid="blocking-order-row"]',
    );
    expect(rows).toHaveLength(2);
    const ids = Array.from(rows).map(
      (r) => (r as HTMLElement).dataset.orderId,
    );
    expect(ids).toContain("o1");
    expect(ids).toContain("o2");
  });

  it("action exclude retourne error sans blocking_orders → flash text affiché, pas de modale", async () => {
    vi.mocked(excludeSlotsByIdsAction).mockResolvedValue({
      error: "Créneau introuvable.",
    } satisfies ExcludeActionResult);

    render(
      <CreneauxCalendarClient
        weekOffset={0}
        periodLabel="25 – 31 mai"
        days={buildDays()}
        rules={RULES}
      />,
    );

    clickBlockThenClose();
    await flushPromises();

    // Pas de modale.
    expect(
      container.querySelector('[data-testid="cancel-and-close-modal"]'),
    ).toBeNull();
    // Flash text présent dans le DOM.
    expect(container.textContent).toContain("Créneau introuvable");
  });

  it("bouton 'Fermer ce jour' reste cliquable même avec hasActiveOrder=true (l'action ouvre la modale)", () => {
    render(
      <CreneauxCalendarClient
        weekOffset={0}
        periodLabel="25 – 31 mai"
        days={buildDays()}
        rules={RULES}
      />,
    );
    // Ouvre menu
    const blockBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => (b.textContent ?? "").includes("10h–10h30")) as
      | HTMLButtonElement
      | undefined;
    act(() => blockBtn!.click());
    // Le bouton "Fermer ce jour" existe et n'est PAS disabled (alors que
    // hasActiveOrder est true). Ancien comportement : il était grisé.
    const closeBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => /Fermer ce jour/i.test(b.textContent ?? "")) as
      | HTMLButtonElement
      | undefined;
    expect(closeBtn).toBeDefined();
    expect(closeBtn!.disabled).toBe(false);
    // L'annotation "commandes à annuler" est visible pour signaler à
    // l'utilisateur que l'action va déclencher la modale.
    expect(closeBtn!.textContent).toMatch(/commandes à annuler/i);
  });
});

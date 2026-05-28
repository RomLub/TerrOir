// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { MonitoringSection } from "@/app/(producer)/creneaux/_components/MonitoringSection";
import type {
  MonitoringBlock,
  MonitoringCell,
  MonitoringDay,
} from "@/lib/slots/group-creneaux-monitoring";

// Stub next/link → <a> standard pour faciliter l'assertion sur href.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function cellReserved(opts: {
  orderId?: string;
  orderNumber?: string;
  consumerFirstName?: string | null;
  subSlotStartIso?: string;
}): MonitoringCell {
  return {
    kind: "reserved",
    orderId: opts.orderId ?? "order-1",
    orderNumber: opts.orderNumber ?? "0001-00001",
    consumerFirstName:
      opts.consumerFirstName === undefined ? "Jean" : opts.consumerFirstName,
    subSlotStartIso: opts.subSlotStartIso ?? "2026-05-28T09:00:00+02:00",
  };
}

function cellFree(subSlotStartIso = "2026-05-28T09:00:00+02:00"): MonitoringCell {
  return { kind: "free", subSlotStartIso };
}

function block(opts: Partial<MonitoringBlock> & { cells: MonitoringCell[] }): MonitoringBlock {
  return {
    key: opts.key ?? "block-1",
    kind: opts.kind ?? "recurring",
    ruleId: opts.ruleId ?? "rule-1",
    label: opts.label ?? "9h–12h",
    mode: opts.mode ?? "libre",
    durationLabel: opts.durationLabel ?? "plage",
    cells: opts.cells,
    totalCapacity: opts.totalCapacity ?? opts.cells.length,
    reservedCount:
      opts.reservedCount ?? opts.cells.filter((c) => c.kind === "reserved").length,
    sortKey: opts.sortKey ?? 0,
  };
}

function day(opts: Partial<MonitoringDay> & { blocks: MonitoringBlock[] }): MonitoringDay {
  const totalCapacity =
    opts.totalCapacity ??
    opts.blocks.reduce((sum, b) => sum + b.totalCapacity, 0);
  const reservedCount =
    opts.reservedCount ??
    opts.blocks.reduce((sum, b) => sum + b.reservedCount, 0);
  return {
    dateKey: opts.dateKey ?? "2026-05-28",
    weekdayLabel: opts.weekdayLabel ?? "Jeudi",
    dayNum: opts.dayNum ?? 28,
    isToday: opts.isToday ?? false,
    blocks: opts.blocks,
    blockCount: opts.blockCount ?? opts.blocks.length,
    totalCapacity,
    reservedCount,
  };
}

describe("<MonitoringSection>", () => {
  it("days vide → ne rend rien", () => {
    const { container } = render(<MonitoringSection days={[]} unavailableDates={new Set()} />);
    expect(container.querySelector('[data-testid="monitoring-section"]')).toBeNull();
  });

  it("rend un jour avec un bloc libre : header + cases + lien commande", () => {
    const d = day({
      blocks: [
        block({
          mode: "libre",
          durationLabel: "plage",
          cells: [
            cellReserved({ orderId: "abc-123", orderNumber: "0001-00001" }),
            cellFree(),
            cellFree(),
            cellFree(),
          ],
        }),
      ],
    });
    render(<MonitoringSection days={[d]} unavailableDates={new Set()} />);

    expect(screen.getByText("Remplissage des places")).toBeTruthy();
    expect(screen.getByText(/Jeudi 28/)).toBeTruthy();
    expect(screen.getByText("9h–12h")).toBeTruthy();
    expect(screen.getByTestId("block-duration").textContent).toBe("plage");

    const reserved = screen.getAllByTestId("monitoring-cell-reserved");
    expect(reserved).toHaveLength(1);
    expect(reserved[0]!.getAttribute("href")).toBe("/commandes/abc-123");
    expect(reserved[0]!.getAttribute("aria-label")).toBe("0001-00001 · Jean");
    expect(reserved[0]!.getAttribute("title")).toBe("0001-00001 · Jean");

    expect(screen.getAllByTestId("monitoring-cell-free")).toHaveLength(3);
  });

  it("mode RDV : tooltip de chaque case contient l'heure du sous-slot", () => {
    const d = day({
      blocks: [
        block({
          mode: "rdv",
          durationLabel: "RDV 30 min",
          cells: [
            cellReserved({
              orderId: "o1",
              orderNumber: "0001-00042",
              consumerFirstName: "Léa",
              subSlotStartIso: "2026-05-28T10:30:00+02:00",
            }),
            cellFree("2026-05-28T11:00:00+02:00"),
          ],
        }),
      ],
    });
    render(<MonitoringSection days={[d]} unavailableDates={new Set()} />);
    const reserved = screen.getByTestId("monitoring-cell-reserved");
    expect(reserved.getAttribute("aria-label")).toBe("10h30 · 0001-00042 · Léa");
    const free = screen.getByTestId("monitoring-cell-free");
    expect(free.getAttribute("aria-label")).toBe("11h · libre");
  });

  it("consumerFirstName null → fallback 'Client'", () => {
    const d = day({
      blocks: [
        block({
          mode: "libre",
          cells: [
            cellReserved({
              orderNumber: "0001-00099",
              consumerFirstName: null,
            }),
          ],
        }),
      ],
    });
    render(<MonitoringSection days={[d]} unavailableDates={new Set()} />);
    const reserved = screen.getByTestId("monitoring-cell-reserved");
    expect(reserved.getAttribute("aria-label")).toBe("0001-00099 · Client");
  });

  it("pluriels : 1 créneau / 2 créneaux, 1 réservée / 3 réservées", () => {
    const oneBlock = day({
      reservedCount: 1,
      totalCapacity: 4,
      blocks: [
        block({
          cells: [cellReserved({}), cellFree(), cellFree(), cellFree()],
        }),
      ],
    });
    const { unmount } = render(<MonitoringSection days={[oneBlock]} unavailableDates={new Set()} />);
    const dayCard = screen.getByTestId("monitoring-day");
    expect(within(dayCard).getByText(/1 créneau$/)).toBeTruthy();
    expect(within(dayCard).getByTestId("day-fill-label").textContent).toBe(
      "1/4 réservée",
    );
    unmount();

    const twoBlocks = day({
      blocks: [
        block({
          key: "b1",
          cells: [cellReserved({}), cellReserved({ orderId: "o2" }), cellFree()],
        }),
        block({
          key: "b2",
          cells: [cellReserved({ orderId: "o3" }), cellFree(), cellFree()],
        }),
      ],
    });
    render(<MonitoringSection days={[twoBlocks]} unavailableDates={new Set()} />);
    const dayCard2 = screen.getByTestId("monitoring-day");
    expect(within(dayCard2).getByText(/2 créneaux$/)).toBeTruthy();
    expect(within(dayCard2).getByTestId("day-fill-label").textContent).toBe(
      "3/6 réservées",
    );
  });

  it("chaque cellule réservée pointe vers son propre orderId", () => {
    const d = day({
      blocks: [
        block({
          cells: [
            cellReserved({ orderId: "id-A" }),
            cellReserved({ orderId: "id-B" }),
            cellReserved({ orderId: "id-C" }),
          ],
        }),
      ],
    });
    render(<MonitoringSection days={[d]} unavailableDates={new Set()} />);
    const links = screen.getAllByTestId("monitoring-cell-reserved");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/commandes/id-A",
      "/commandes/id-B",
      "/commandes/id-C",
    ]);
  });

  it("plusieurs jours rendus dans l'ordre fourni", () => {
    const d1 = day({
      dateKey: "2026-05-25",
      weekdayLabel: "Lundi",
      dayNum: 25,
      blocks: [block({ cells: [cellFree()] })],
    });
    const d2 = day({
      dateKey: "2026-05-28",
      weekdayLabel: "Jeudi",
      dayNum: 28,
      blocks: [block({ cells: [cellFree()] })],
    });
    render(<MonitoringSection days={[d1, d2]} unavailableDates={new Set()} />);
    const cards = screen.getAllByTestId("monitoring-day");
    expect(cards.map((c) => c.getAttribute("data-date-key"))).toEqual([
      "2026-05-25",
      "2026-05-28",
    ]);
  });

  it("affiche une ligne Indisponibilité pour un jour fermé sans créneau actif", () => {
    render(
      <MonitoringSection
        days={[]}
        unavailableDates={new Set(["2026-05-29"])}
      />,
    );

    expect(screen.getByTestId("monitoring-section")).toBeTruthy();
    const unavailable = screen.getByTestId("monitoring-day-unavailable");
    expect(unavailable.getAttribute("data-date-key")).toBe("2026-05-29");
    expect(within(unavailable).getByText("Indisponibilité")).toBeTruthy();
  });

  it("fusionne jours avec créneaux et jours indisponibles en ordre chronologique", () => {
    const d = day({
      dateKey: "2026-05-30",
      weekdayLabel: "Samedi",
      dayNum: 30,
      blocks: [block({ cells: [cellFree()] })],
    });

    render(
      <MonitoringSection
        days={[d]}
        unavailableDates={new Set(["2026-05-29"])}
      />,
    );

    const rows = Array.from(
      document.querySelectorAll(
        '[data-testid="monitoring-day-unavailable"], [data-testid="monitoring-day"]',
      ),
    );
    expect(rows.map((r) => r.getAttribute("data-date-key"))).toEqual([
      "2026-05-29",
      "2026-05-30",
    ]);
  });
});

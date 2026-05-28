// @vitest-environment jsdom
// Tests des helpers purs + rendu basique de MonthCalendar. Vérifient :
//   - buildMonthGrid : structure 42 cellules, padding avant/après, dayNum
//   - navigation mois (prev → janvier → décembre année-1)
//   - todayParisKey : format YYYY-MM-DD

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MonthCalendar,
  buildMonthGrid,
  todayParisKey,
} from "@/app/(producer)/creneaux/_components/_month-calendar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("buildMonthGrid", () => {
  it("toujours 42 cellules (6 semaines × 7 jours)", () => {
    const g = buildMonthGrid(2026, 5); // juin 2026
    expect(g).toHaveLength(42);
  });

  it("juin 2026 : 1er = lundi → aucun padding avant", () => {
    const g = buildMonthGrid(2026, 5);
    expect(g[0]).toMatchObject({ dayNum: 1, inMonth: true });
  });

  it("août 2026 : 1er = samedi → 5 cellules de padding avant", () => {
    const g = buildMonthGrid(2026, 7);
    expect(g[0]?.inMonth).toBe(false);
    expect(g[5]?.dayNum).toBe(1);
    expect(g[5]?.inMonth).toBe(true);
  });

  it("dateKey conforme YYYY-MM-DD", () => {
    const g = buildMonthGrid(2026, 0); // janvier
    const firstOfMonth = g.find((c) => c.inMonth && c.dayNum === 1);
    expect(firstOfMonth?.dateKey).toBe("2026-01-01");
  });

  it("février 2024 (bissextile) : 29 jours du mois", () => {
    const g = buildMonthGrid(2024, 1);
    const inMonth = g.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
  });
});

describe("todayParisKey", () => {
  it("format YYYY-MM-DD valide", () => {
    const key = todayParisKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("respecte la TZ Europe/Paris (proche minuit UTC, on est encore la veille à Paris)", () => {
    // 2026-06-15 23:30 UTC = 2026-06-16 01:30 Europe/Paris (été CEST UTC+2)
    const at = new Date("2026-06-15T23:30:00Z");
    const key = todayParisKey(at);
    expect(key).toBe("2026-06-16");
  });
});

describe("<MonthCalendar>", () => {
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

  it("rend 42 cellules + 7 en-têtes Lun→Dim", () => {
    const cb = vi.fn();
    act(() =>
      root.render(
        <MonthCalendar
          year={2026}
          month0={5}
          onChangeMonth={cb}
          renderCell={(c) => <span data-testid="cell">{c.dayNum}</span>}
        />,
      ),
    );
    const cells = container.querySelectorAll('[data-testid="cell"]');
    expect(cells).toHaveLength(42);
    expect(container.textContent).toContain("Lun");
    expect(container.textContent).toContain("Dim");
    expect(container.textContent).toContain("Juin 2026");
  });

  it("flèche mois précédent : janvier → décembre année-1", () => {
    const cb = vi.fn();
    act(() =>
      root.render(
        <MonthCalendar
          year={2026}
          month0={0}
          onChangeMonth={cb}
          renderCell={() => null}
        />,
      ),
    );
    const prev = container.querySelector('[aria-label="Mois précédent"]') as
      | HTMLButtonElement
      | null;
    act(() => prev?.click());
    expect(cb).toHaveBeenCalledWith(2025, 11);
  });

  it("flèche mois suivant : décembre → janvier année+1", () => {
    const cb = vi.fn();
    act(() =>
      root.render(
        <MonthCalendar
          year={2026}
          month0={11}
          onChangeMonth={cb}
          renderCell={() => null}
        />,
      ),
    );
    const next = container.querySelector('[aria-label="Mois suivant"]') as
      | HTMLButtonElement
      | null;
    act(() => next?.click());
    expect(cb).toHaveBeenCalledWith(2027, 0);
  });
});

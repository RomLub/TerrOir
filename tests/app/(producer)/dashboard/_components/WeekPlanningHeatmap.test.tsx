// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

// Tests jsdom du composant WeekPlanningHeatmap. Couvrent : rendu jour fermé,
// rendu jour ouvert vide, positionnement des segments, couleurs selon
// orders/capacity, sous-titre métrique, drill-down, graduations, isToday,
// fallback hourRange.

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    [k: string]: unknown;
  }) => (
    <a href={href} className={className} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

import {
  WeekPlanningHeatmap,
  type WeekPlanningDay,
} from '@/app/(producer)/dashboard/_components/WeekPlanningHeatmap';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
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

function makeDay(
  dateIso: string,
  over: Partial<WeekPlanningDay> = {},
): WeekPlanningDay {
  return {
    dateIso,
    dayLabel: 'Lun 25',
    isToday: false,
    isOpen: true,
    slots: [],
    ...over,
  };
}

function row(dateIso: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="planning-day-row"][data-date-iso="${dateIso}"]`,
  ) as HTMLElement | null;
  if (!el) throw new Error(`row not found for ${dateIso}`);
  return el;
}

function segmentsIn(rowEl: HTMLElement): HTMLElement[] {
  return Array.from(
    rowEl.querySelectorAll('[data-testid="planning-segment"]'),
  ) as HTMLElement[];
}

function pct(s: string): number {
  return Number.parseFloat(s.replace('%', ''));
}

function sevenDays(over: Partial<WeekPlanningDay> = {}): WeekPlanningDay[] {
  return Array.from({ length: 7 }, (_, i) =>
    makeDay(`2026-05-${25 + i}`, { dayLabel: `J${i}`, ...over }),
  );
}

describe('WeekPlanningHeatmap — rendu jour', () => {
  it('jour fermé : sous-titre "Fermé", aucun segment', () => {
    render(
      <WeekPlanningHeatmap
        days={sevenDays({ isOpen: false })}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const r = row('2026-05-25');
    expect(r.textContent).toContain('Fermé');
    expect(segmentsIn(r)).toHaveLength(0);
    // data-is-open reflète l'état pour les tests de drill-down et style.
    expect(r.dataset.isOpen).toBe('0');
  });

  it('jour ouvert vide : sous-titre "Aucun créneau", aucun segment', () => {
    render(
      <WeekPlanningHeatmap
        days={sevenDays({ isOpen: true })}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const r = row('2026-05-25');
    expect(r.textContent).toContain('Aucun créneau');
    expect(segmentsIn(r)).toHaveLength(0);
    expect(r.dataset.isOpen).toBe('1');
  });

  it('jour ouvert avec slots : positionnement left/width en % sur la range [8, 20]', () => {
    const days = sevenDays();
    days[0] = makeDay('2026-05-25', {
      isOpen: true,
      slots: [
        {
          id: 's1',
          // 9h30 → 12h sur [8, 20] (span = 12) :
          //   left = (9.5 - 8) / 12 = 12.5%
          //   width = (12 - 9.5) / 12 ≈ 20.833%
          startHourFrac: 9.5,
          endHourFrac: 12,
          capacity: 5,
          ordersCount: 0,
        },
      ],
    });
    render(
      <WeekPlanningHeatmap days={days} hourRange={{ startHour: 8, endHour: 20 }} />,
    );
    const segs = segmentsIn(row('2026-05-25'));
    expect(segs).toHaveLength(1);
    expect(pct(segs[0]!.style.left)).toBeCloseTo(12.5, 1);
    expect(pct(segs[0]!.style.width)).toBeCloseTo(20.833, 1);
  });
});

describe('WeekPlanningHeatmap — couleurs des segments', () => {
  it('orders_count === 0 : segment vert (libre)', () => {
    const days = sevenDays();
    days[0] = makeDay('2026-05-25', {
      isOpen: true,
      slots: [
        {
          id: 's1',
          startHourFrac: 9,
          endHourFrac: 10,
          capacity: 5,
          ordersCount: 0,
        },
      ],
    });
    render(
      <WeekPlanningHeatmap days={days} hourRange={{ startHour: 8, endHour: 20 }} />,
    );
    const seg = segmentsIn(row('2026-05-25'))[0]!;
    expect(seg.className).toContain('bg-green-700');
    expect(seg.className).not.toContain('bg-terra-700');
  });

  it('orders_count >= 1 et < capacity : segment terra (réservé partiel) sans ring', () => {
    const days = sevenDays();
    days[0] = makeDay('2026-05-25', {
      isOpen: true,
      slots: [
        {
          id: 's1',
          startHourFrac: 9,
          endHourFrac: 10,
          capacity: 5,
          ordersCount: 2,
        },
      ],
    });
    render(
      <WeekPlanningHeatmap days={days} hourRange={{ startHour: 8, endHour: 20 }} />,
    );
    const seg = segmentsIn(row('2026-05-25'))[0]!;
    expect(seg.className).toContain('bg-terra-700');
    // Pas de ring tant que la capacité n'est pas atteinte.
    expect(seg.className).not.toMatch(/\bring-1\b/);
  });

  it('orders_count >= capacity : segment terra plein + ring discret', () => {
    const days = sevenDays();
    days[0] = makeDay('2026-05-25', {
      isOpen: true,
      slots: [
        {
          id: 's1',
          startHourFrac: 9,
          endHourFrac: 10,
          capacity: 5,
          ordersCount: 5,
        },
      ],
    });
    render(
      <WeekPlanningHeatmap days={days} hourRange={{ startHour: 8, endHour: 20 }} />,
    );
    const seg = segmentsIn(row('2026-05-25'))[0]!;
    expect(seg.className).toContain('bg-terra-700');
    expect(seg.className).toMatch(/\bring-1\b/);
    expect(seg.className).toContain('ring-terra-900');
  });
});

describe('WeekPlanningHeatmap — sous-titre métrique', () => {
  it('agrège dispo et réservés sur tous les slots du jour', () => {
    const days = sevenDays();
    days[0] = makeDay('2026-05-25', {
      isOpen: true,
      slots: [
        { id: 's1', startHourFrac: 9, endHourFrac: 10, capacity: 5, ordersCount: 2 },
        { id: 's2', startHourFrac: 10, endHourFrac: 11, capacity: 5, ordersCount: 0 },
        { id: 's3', startHourFrac: 11, endHourFrac: 12, capacity: 3, ordersCount: 3 },
      ],
    });
    render(
      <WeekPlanningHeatmap days={days} hourRange={{ startHour: 8, endHour: 20 }} />,
    );
    // dispo = (5-2) + (5-0) + (3-3) = 8 ; réservés = 2 + 0 + 3 = 5.
    expect(row('2026-05-25').textContent).toContain('8 dispo · 5 réservés');
  });

  it('orders_count > capacity (cas pathologique) : dispo clampé à 0', () => {
    const days = sevenDays();
    days[0] = makeDay('2026-05-25', {
      isOpen: true,
      slots: [
        { id: 's1', startHourFrac: 9, endHourFrac: 10, capacity: 2, ordersCount: 5 },
      ],
    });
    render(
      <WeekPlanningHeatmap days={days} hourRange={{ startHour: 8, endHour: 20 }} />,
    );
    // dispo = max(0, 2-5) = 0 ; réservés = 5.
    expect(row('2026-05-25').textContent).toContain('0 dispo · 5 réservés');
  });
});

describe('WeekPlanningHeatmap — drill-down', () => {
  it('chaque rangée est un <a href="/creneaux?day=YYYY-MM-DD">', () => {
    render(
      <WeekPlanningHeatmap
        days={sevenDays()}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const r = row('2026-05-27');
    expect(r.tagName).toBe('A');
    expect(r.getAttribute('href')).toBe('/creneaux?day=2026-05-27');
  });
});

describe('WeekPlanningHeatmap — axe horaire', () => {
  it('span ≤ 12h : tick toutes les heures (8h → 20h = 13 ticks)', () => {
    render(
      <WeekPlanningHeatmap
        days={sevenDays()}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    // Le composant ne tagge pas les ticks individuellement, on lit le HTML
    // de la zone axe (le 2e enfant du composant racine).
    const heatmap = container.querySelector('[data-testid="week-planning-heatmap"]')!;
    const axis = heatmap.lastElementChild as HTMLElement;
    const ticks = axis.querySelectorAll('.tabular-nums');
    // 8, 9, 10, ..., 20 → 13 ticks.
    expect(ticks.length).toBe(13);
    expect(ticks[0]!.textContent).toBe('8h');
    expect(ticks[ticks.length - 1]!.textContent).toBe('20h');
  });

  it('span > 12h : tick toutes les 2h (6h → 22h = 9 ticks)', () => {
    render(
      <WeekPlanningHeatmap
        days={sevenDays()}
        hourRange={{ startHour: 6, endHour: 22 }}
      />,
    );
    const heatmap = container.querySelector('[data-testid="week-planning-heatmap"]')!;
    const axis = heatmap.lastElementChild as HTMLElement;
    const ticks = axis.querySelectorAll('.tabular-nums');
    // 6, 8, 10, 12, 14, 16, 18, 20, 22 → 9 ticks.
    expect(ticks.length).toBe(9);
    expect(Array.from(ticks).map((t) => t.textContent)).toEqual([
      '6h',
      '8h',
      '10h',
      '12h',
      '14h',
      '16h',
      '18h',
      '20h',
      '22h',
    ]);
  });
});

describe('WeekPlanningHeatmap — divers', () => {
  it('isToday : la rangée a une classe distinctive (highlight vert)', () => {
    const days = sevenDays();
    days[0] = makeDay('2026-05-25', { isToday: true });
    render(
      <WeekPlanningHeatmap days={days} hourRange={{ startHour: 8, endHour: 20 }} />,
    );
    const r = row('2026-05-25');
    expect(r.className).toContain('bg-green-100/40');
  });

  it('fallback hourRange [8, 20] passé en prop : 12h span, axe avec 13 ticks (cas semaine vide)', () => {
    render(
      <WeekPlanningHeatmap
        days={sevenDays({ isOpen: true, slots: [] })}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const heatmap = container.querySelector('[data-testid="week-planning-heatmap"]')!;
    const axis = heatmap.lastElementChild as HTMLElement;
    expect(axis.querySelectorAll('.tabular-nums').length).toBe(13);
    // Et aucun jour n'a de segment.
    expect(container.querySelectorAll('[data-testid="planning-segment"]').length).toBe(0);
  });
});

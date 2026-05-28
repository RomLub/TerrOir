// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

// Tests jsdom du composant VerticalWeekCalendar. Couvrent : rendu colonnes,
// compteur orders, bande sans cmd (non-interactive), bande avec cmd
// (cliquable), popover ouvert au clic + lien commande, multi-plages par
// jour, jour vide (norme : 5-6 colonnes vides par défaut chez circuit
// court), invariant len(orders) === totalOrders, Escape ferme le popover.

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
  VerticalWeekCalendar,
  type VerticalDay,
  type VerticalSlot,
} from '@/app/(producer)/dashboard/_components/VerticalWeekCalendar';

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

const RULE_A = '11111111-1111-1111-1111-111111111111';

// Construction d'un slot — heures UTC en juin (CEST UTC+2). Pour qu'un
// slot tombe à 9h30 Paris : starts_at = 07:30Z.
function makeSlot(over: Partial<VerticalSlot> & { id: string }): VerticalSlot {
  return {
    starts_at: '2026-06-03T07:00:00.000Z',
    ends_at: '2026-06-03T09:00:00.000Z',
    capacity_per_slot: 5,
    rule_id: RULE_A,
    orders_count: 0,
    orders: [],
    ...over,
  };
}

function makeDay(over: Partial<VerticalDay>): VerticalDay {
  return {
    dateIso: '2026-06-03',
    dayLabel: 'Mer 3',
    isToday: false,
    slots: [],
    ...over,
  };
}

function sevenDays(filled?: { idx: number; day: VerticalDay }): VerticalDay[] {
  const baseDate = new Date('2026-06-01T00:00:00.000Z');
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(baseDate);
    d.setUTCDate(baseDate.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    return makeDay({ dateIso: iso, dayLabel: `J${i}` });
  });
  if (filled) days[filled.idx] = filled.day;
  return days;
}

function bands(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="planning-band"]'),
  ) as HTMLElement[];
}

function bandsForDay(dateIso: string): HTMLElement[] {
  const col = container.querySelector(
    `[data-testid="planning-day-column"][data-date-iso="${dateIso}"]`,
  ) as HTMLElement | null;
  if (!col) return [];
  return Array.from(
    col.querySelectorAll('[data-testid="planning-band"]'),
  ) as HTMLElement[];
}

describe('VerticalWeekCalendar — rendu colonnes & bandes', () => {
  it('rend 7 colonnes-jours et l\'axe horaire avec graduations', () => {
    render(
      <VerticalWeekCalendar
        days={sevenDays()}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const cols = container.querySelectorAll('[data-testid="planning-day-column"]');
    expect(cols).toHaveLength(7);
    // Au moins une graduation horaire visible (axe).
    expect(container.textContent).toContain('8h');
    expect(container.textContent).toContain('20h');
  });

  it('rend une bande pour une rule un jour, sans compteur quand 0 commande', () => {
    const slot = makeSlot({ id: 's1' });
    const days = sevenDays({
      idx: 2,
      day: makeDay({ dateIso: '2026-06-03', slots: [slot] }),
    });
    render(
      <VerticalWeekCalendar
        days={days}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const b = bandsForDay('2026-06-03');
    expect(b).toHaveLength(1);
    expect(b[0]!.dataset.ordersCount).toBe('0');
    // Bande non-cliquable (pas de button) puisque 0 commande.
    expect(b[0]!.tagName.toLowerCase()).toBe('div');
  });

  it('rend une bande cliquable + badge compteur quand >= 1 commande', () => {
    const slot = makeSlot({
      id: 's1',
      orders_count: 2,
      orders: [
        {
          order_id: 'o1',
          code_commande: 'TRR-AAA01',
          starts_at: '2026-06-03T07:00:00.000Z',
        },
        {
          order_id: 'o2',
          code_commande: 'TRR-BBB02',
          starts_at: '2026-06-03T07:00:00.000Z',
        },
      ],
    });
    const days = sevenDays({
      idx: 2,
      day: makeDay({ dateIso: '2026-06-03', slots: [slot] }),
    });
    render(
      <VerticalWeekCalendar
        days={days}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const b = bandsForDay('2026-06-03');
    expect(b).toHaveLength(1);
    expect(b[0]!.dataset.ordersCount).toBe('2');
    expect(b[0]!.tagName.toLowerCase()).toBe('button');
    // Le badge contient le nombre.
    expect(b[0]!.textContent).toContain('2');
  });
});

describe('VerticalWeekCalendar — popover & navigation', () => {
  it('clic sur bande ouvre le popover avec liens vers /commandes/[id]', () => {
    const slot = makeSlot({
      id: 's1',
      orders_count: 1,
      orders: [
        {
          order_id: 'order-xyz',
          code_commande: 'TRR-HLFSJN5',
          starts_at: '2026-06-03T07:00:00.000Z',
        },
      ],
    });
    const days = sevenDays({
      idx: 2,
      day: makeDay({ dateIso: '2026-06-03', slots: [slot] }),
    });
    render(
      <VerticalWeekCalendar
        days={days}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    // Avant clic : pas de popover.
    expect(
      container.querySelector('[data-testid="planning-band-popover"]'),
    ).toBeNull();

    const btn = bandsForDay('2026-06-03')[0]!;
    act(() => {
      btn.click();
    });

    const popover = container.querySelector(
      '[data-testid="planning-band-popover"]',
    );
    expect(popover).not.toBeNull();
    const link = container.querySelector(
      '[data-testid="planning-band-order-link"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/commandes/order-xyz');
    expect(link!.textContent).toContain('TRR-HLFSJN5');
  });

  it('Escape ferme le popover ouvert', () => {
    const slot = makeSlot({
      id: 's1',
      orders_count: 1,
      orders: [
        {
          order_id: 'o1',
          code_commande: 'TRR-ZZZ',
          starts_at: '2026-06-03T07:00:00.000Z',
        },
      ],
    });
    const days = sevenDays({
      idx: 2,
      day: makeDay({ dateIso: '2026-06-03', slots: [slot] }),
    });
    render(
      <VerticalWeekCalendar
        days={days}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    act(() => {
      bandsForDay('2026-06-03')[0]!.click();
    });
    expect(
      container.querySelector('[data-testid="planning-band-popover"]'),
    ).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(
      container.querySelector('[data-testid="planning-band-popover"]'),
    ).toBeNull();
  });
});

describe('VerticalWeekCalendar — cas multi-plages et jour vide', () => {
  it('deux plages le même jour (deux rules) → deux bandes', () => {
    const slots: VerticalSlot[] = [
      makeSlot({ id: 's1', rule_id: 'RULE-A' }),
      makeSlot({
        id: 's2',
        rule_id: 'RULE-B',
        starts_at: '2026-06-03T13:00:00.000Z',
        ends_at: '2026-06-03T15:00:00.000Z',
      }),
    ];
    const days = sevenDays({
      idx: 2,
      day: makeDay({ dateIso: '2026-06-03', slots }),
    });
    render(
      <VerticalWeekCalendar
        days={days}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    expect(bandsForDay('2026-06-03')).toHaveLength(2);
  });

  it('jour vide reste élégant : pas de bande, pas de "fermé" textuel, colonne visible', () => {
    // Cas nominal du producteur circuit court : ouvert 1-2 jours/semaine.
    // Les 5-6 autres jours doivent rester élégants — pas un calendrier
    // cassé. On vérifie : aucune bande, AUCUN texte "fermé", colonne
    // bien rendue, axe horaire toujours visible.
    render(
      <VerticalWeekCalendar
        days={sevenDays()}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    expect(bands()).toHaveLength(0);
    expect(container.textContent?.toLowerCase()).not.toContain('fermé');
    expect(container.textContent?.toLowerCase()).not.toContain('aucun');
    // 7 colonnes-jours rendues même sans bande.
    expect(
      container.querySelectorAll('[data-testid="planning-day-column"]'),
    ).toHaveLength(7);
    // Axe horaire toujours visible (au moins une graduation).
    expect(container.textContent).toContain('8h');
  });
});

describe('VerticalWeekCalendar — invariants & isToday', () => {
  it('isToday remonte sur la colonne-jour pour styling', () => {
    const days = sevenDays({
      idx: 2,
      day: makeDay({ dateIso: '2026-06-03', isToday: true }),
    });
    render(
      <VerticalWeekCalendar
        days={days}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const col = container.querySelector(
      '[data-testid="planning-day-column"][data-date-iso="2026-06-03"]',
    ) as HTMLElement;
    expect(col.dataset.isToday).toBe('1');
  });

  it('invariant len(popover orders) === totalOrders (badge compteur cohérent)', () => {
    const slot = makeSlot({
      id: 's1',
      orders_count: 3,
      orders: [
        {
          order_id: 'o1',
          code_commande: 'TRR-A1',
          starts_at: '2026-06-03T07:00:00.000Z',
        },
        {
          order_id: 'o2',
          code_commande: 'TRR-A2',
          starts_at: '2026-06-03T07:00:00.000Z',
        },
        {
          order_id: 'o3',
          code_commande: 'TRR-A3',
          starts_at: '2026-06-03T07:00:00.000Z',
        },
      ],
    });
    const days = sevenDays({
      idx: 2,
      day: makeDay({ dateIso: '2026-06-03', slots: [slot] }),
    });
    render(
      <VerticalWeekCalendar
        days={days}
        hourRange={{ startHour: 8, endHour: 20 }}
      />,
    );
    const b = bandsForDay('2026-06-03')[0]!;
    expect(b.dataset.ordersCount).toBe('3');
    act(() => {
      b.click();
    });
    const links = container.querySelectorAll(
      '[data-testid="planning-band-order-link"]',
    );
    expect(links).toHaveLength(3);
  });
});

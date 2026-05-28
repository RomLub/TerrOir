// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

// Tests de la navigation swipe client du dashboard (2026-05-28). On vérifie
// que cliquer une flèche du WeekNavigator (mode "client") change l'index
// local du DashboardClient SANS déclencher de router.push ni de Suspense
// fallback — tout est déjà en mémoire, le swipe est instantané.

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
    [k: string]: unknown;
  }) => (
    <a href={href} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  }),
}));

vi.mock('@/components/ui', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  ProducerBadge: ({ kind }: { kind: string }) => <div data-testid={`badge-${kind}`} />,
}));

vi.mock('@/components/producer/StatCard', () => ({
  StatCard: ({
    label,
    value,
    sub,
  }: {
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
  }) => (
    <div data-testid="statcard" data-label={label}>
      <div>{value}</div>
      <div>{sub}</div>
    </div>
  ),
}));

import {
  DashboardClient,
  type DashboardData,
} from '@/app/(producer)/dashboard/DashboardClient';
import type { VerticalDay } from '@/app/(producer)/dashboard/_components/VerticalWeekCalendar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  pushMock.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(node: ReactElement) {
  act(() => root.render(node));
}

const WEEK_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function weekFrom(startIsoDay: string): VerticalDay[] {
  const base = new Date(`${startIsoDay}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    return {
      dateIso: iso,
      dayLabel: `${WEEK_LABELS[i]} ${d.getUTCDate()}`,
      isToday: false,
      slots: [],
    };
  });
}

function makeData(): DashboardData {
  return {
    producerId: 'p1',
    producerName: 'Ferme Test',
    firstName: 'Pierre',
    weekPlannings: [
      weekFrom('2026-05-18'), // 0
      weekFrom('2026-05-25'), // 1 = courante
      weekFrom('2026-06-01'), // 2
      weekFrom('2026-06-08'), // 3
      weekFrom('2026-06-15'), // 4
      weekFrom('2026-06-22'), // 5
      weekFrom('2026-06-29'), // 6
      weekFrom('2026-07-06'), // 7
      weekFrom('2026-07-13'), // 8
      weekFrom('2026-07-20'), // 9
    ],
    weekPeriodLabels: [
      '18 – 24 mai',
      '25 – 31 mai',
      '1 – 7 juin',
      '8 – 14 juin',
      '15 – 21 juin',
      '22 – 28 juin',
      '29 juin – 5 juillet',
      '6 – 12 juillet',
      '13 – 19 juillet',
      '20 – 26 juillet',
    ],
    currentWeekIndex: 1,
    ordersToday: 0,
    ordersYesterday: 0,
    revenueWeek: 0,
    revenueLastWeek: 0,
    rating: 0,
    reviewCount: 0,
    nextPickup: null,
    pendingOrders: [],
    badges: [],
    stockAlerts: [],
    publicationToDo: null,
  };
}

function firstPlanningDay(): string {
  const col = container.querySelector(
    '[data-testid="planning-day-column"]',
  ) as HTMLElement | null;
  return col?.dataset.dateIso ?? '';
}

function arrow(label: 'Semaine précédente' | 'Semaine suivante'): HTMLElement | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

function homeButton(): HTMLButtonElement | null {
  const btns = Array.from(container.querySelectorAll('button'));
  return (
    (btns.find((b) => b.textContent === 'Revenir à cette semaine') as
      | HTMLButtonElement
      | undefined) ?? null
  );
}

function clickEl(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
  });
}

describe('DashboardClient — navigation swipe client', () => {
  it('démarre sur currentWeekIndex (= 1) au mount', () => {
    render(<DashboardClient data={makeData()} />);
    expect(firstPlanningDay()).toBe('2026-05-25');
  });

  it('flèche suivante : avance d\'1 semaine, AUCUN router.push ni refetch', () => {
    render(<DashboardClient data={makeData()} />);
    clickEl(arrow('Semaine suivante')!);
    expect(firstPlanningDay()).toBe('2026-06-01');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('flèche précédente : recule d\'1 semaine, AUCUN router.push', () => {
    render(<DashboardClient data={makeData()} />);
    clickEl(arrow('Semaine précédente')!);
    expect(firstPlanningDay()).toBe('2026-05-18');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('borne basse (index 0) : flèche précédente non rendue, suivante reste cliquable', () => {
    render(<DashboardClient data={makeData()} />);
    // Recule jusqu'à l'index 0.
    clickEl(arrow('Semaine précédente')!);
    expect(firstPlanningDay()).toBe('2026-05-18');
    expect(arrow('Semaine précédente')).toBeNull();
    expect(arrow('Semaine suivante')).not.toBeNull();
  });

  it('borne haute (index 9) : flèche suivante non rendue, précédente reste cliquable', () => {
    render(<DashboardClient data={makeData()} />);
    // Avance jusqu'à l'index 9 (+8 clics depuis index 1).
    for (let i = 0; i < 8; i++) {
      clickEl(arrow('Semaine suivante')!);
    }
    expect(firstPlanningDay()).toBe('2026-07-20');
    expect(arrow('Semaine suivante')).toBeNull();
    expect(arrow('Semaine précédente')).not.toBeNull();
    // Aucun reload sur l'enchaînement complet.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('« Revenir à cette semaine » → retour à l\'index 1 (semaine courante)', () => {
    render(<DashboardClient data={makeData()} />);
    // Avance de 3 semaines.
    clickEl(arrow('Semaine suivante')!);
    clickEl(arrow('Semaine suivante')!);
    clickEl(arrow('Semaine suivante')!);
    expect(firstPlanningDay()).toBe('2026-06-15');

    const home = homeButton();
    expect(home).not.toBeNull();
    clickEl(home!);
    expect(firstPlanningDay()).toBe('2026-05-25');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('sur la semaine courante : pas de bouton « Revenir », mention « Cette semaine »', () => {
    render(<DashboardClient data={makeData()} />);
    expect(homeButton()).toBeNull();
    expect(container.textContent).toContain('Cette semaine');
  });

  it('Revenus cette semaine reste FIGÉ après navigation swipe (option A)', () => {
    const data = makeData();
    data.revenueWeek = 123.45;
    data.revenueLastWeek = 100;
    render(<DashboardClient data={data} />);

    function revenueValue(): string {
      const cards = Array.from(
        container.querySelectorAll('[data-testid="statcard"]'),
      ) as HTMLElement[];
      const card = cards.find((c) => c.dataset.label === 'Revenus cette semaine');
      return card?.querySelector('div')?.textContent ?? '';
    }

    const initial = revenueValue();
    expect(initial).toContain('123,45');

    // Navigation arbitraire : +5 semaines.
    for (let i = 0; i < 5; i++) clickEl(arrow('Semaine suivante')!);
    // Le StatCard revenu n'a pas bougé.
    expect(revenueValue()).toBe(initial);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

// Tests anti-régression du fix « state stale » (2026-05-27) : le
// DashboardClient consomme désormais directement la prop `data` (plus de
// `useState(initial)` qui figeait le snapshot serveur au premier mount).
// On vérifie ici que les ré-renders propagent les nouvelles données du
// Server Component (semaine consultée, planning, label) et que le
// compteur live `ordersToday`, isolé dans son propre state pour absorber
// les events realtime, se resync correctement sur changement de prop.
//
// Le fichier voisin (DashboardClient.test.tsx) reste en SSR pur pour les
// sous-cartes Publication — pragma jsdom intentionnellement séparé.

// Capture du callback realtime pour le déclencher dans les tests.
type RealtimeCallback = () => void;
const realtimeRef: { cb: RealtimeCallback | null } = { cb: null };

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
      on: (_event: string, _filter: unknown, cb: RealtimeCallback) => {
        realtimeRef.cb = cb;
        return {
          subscribe: () => ({}),
        };
      },
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
      <div data-testid="statcard-value">{value}</div>
      <div data-testid="statcard-sub">{sub}</div>
    </div>
  ),
}));

// Mock minimal de WeekNavigator pour vérifier les props reçues sans
// instancier sa machinerie de transition (testée séparément).
vi.mock('@/app/(producer)/_components/WeekNavigator', () => ({
  WeekNavigator: ({
    weekOffset,
    periodLabel,
    isPending,
  }: {
    weekOffset: number;
    periodLabel: string;
    isPending?: boolean;
    onNavigate?: (href: string) => void;
  }) => (
    <div
      data-testid="week-navigator"
      data-week-offset={String(weekOffset)}
      data-period-label={periodLabel}
      data-is-pending={isPending ? '1' : '0'}
    />
  ),
}));

import { DashboardClient, type DashboardData } from '@/app/(producer)/dashboard/DashboardClient';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  pushMock.mockReset();
  realtimeRef.cb = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(node: ReactElement) {
  act(() => root.render(node));
}

function makeDay(
  dateIso: string,
  dayLabel: string,
  over: { isToday?: boolean; slots?: DashboardData['weekPlanning'][number]['slots'] } = {},
): DashboardData['weekPlanning'][number] {
  return {
    dateIso,
    dayLabel,
    isToday: over.isToday ?? false,
    slots: over.slots ?? [],
  };
}

function makeData(over: Partial<DashboardData> = {}): DashboardData {
  return {
    producerId: 'p1',
    producerName: 'Ferme Test',
    firstName: 'Pierre',
    weekOffset: 0,
    weekPeriodLabel: '25 – 31 mai',
    ordersToday: 3,
    ordersYesterday: 2,
    revenueWeek: 100,
    revenueLastWeek: 80,
    rating: 0,
    reviewCount: 0,
    nextPickup: null,
    pendingOrders: [],
    weekPlanning: [
      makeDay('2026-05-25', 'Lun 25', { isToday: true }),
      makeDay('2026-05-26', 'Mar 26'),
      makeDay('2026-05-27', 'Mer 27'),
      makeDay('2026-05-28', 'Jeu 28'),
      makeDay('2026-05-29', 'Ven 29'),
      makeDay('2026-05-30', 'Sam 30'),
      makeDay('2026-05-31', 'Dim 31'),
    ],
    badges: [],
    stockAlerts: [],
    publicationToDo: null,
    ...over,
  };
}

function statCardSub(label: string): string {
  const cards = Array.from(
    container.querySelectorAll('[data-testid="statcard"]'),
  ) as HTMLElement[];
  const card = cards.find((c) => c.dataset.label === label);
  if (!card) throw new Error(`StatCard non trouvée : ${label}`);
  return card.querySelector('[data-testid="statcard-value"]')!.textContent ?? '';
}

function weekNavigatorAttrs(): { offset: string; label: string } {
  const wn = container.querySelector('[data-testid="week-navigator"]') as HTMLElement;
  return {
    offset: wn.dataset.weekOffset ?? '',
    label: wn.dataset.periodLabel ?? '',
  };
}

function planningDays(): string[] {
  // Le `weekPlanning` est rendu via VerticalWeekCalendar, qui produit une
  // colonne `<div data-testid="planning-day-column" data-date-iso="…">` par
  // jour. On lit le data-date-iso (clé stable) pour vérifier la propagation
  // de prop, indépendamment du formatage du label.
  const cols = container.querySelectorAll('[data-testid="planning-day-column"]');
  return Array.from(cols).map((c) => (c as HTMLElement).dataset.dateIso ?? '');
}

describe('DashboardClient — propagation prop sur re-render (anti-stale)', () => {
  it('change le label de période, le weekOffset transmis au WeekNavigator et les jours de la grille', () => {
    const initial = makeData({
      weekOffset: 0,
      weekPeriodLabel: '25 – 31 mai',
    });
    render(<DashboardClient data={initial} />);
    expect(weekNavigatorAttrs()).toEqual({ offset: '0', label: '25 – 31 mai' });
    expect(planningDays()).toEqual([
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
      '2026-05-28',
      '2026-05-29',
      '2026-05-30',
      '2026-05-31',
    ]);

    // Simule la navigation soft : nouveau payload serveur.
    const next = makeData({
      weekOffset: -1,
      weekPeriodLabel: '18 – 24 mai',
      weekPlanning: [
        makeDay('2026-05-18', 'Lun 18'),
        makeDay('2026-05-19', 'Mar 19'),
        makeDay('2026-05-20', 'Mer 20'),
        makeDay('2026-05-21', 'Jeu 21'),
        makeDay('2026-05-22', 'Ven 22'),
        makeDay('2026-05-23', 'Sam 23'),
        makeDay('2026-05-24', 'Dim 24'),
      ],
    });
    render(<DashboardClient data={next} />);

    expect(weekNavigatorAttrs()).toEqual({ offset: '-1', label: '18 – 24 mai' });
    expect(planningDays()).toEqual([
      '2026-05-18',
      '2026-05-19',
      '2026-05-20',
      '2026-05-21',
      '2026-05-22',
      '2026-05-23',
      '2026-05-24',
    ]);
  });
});

describe('DashboardClient — ordersToday isolé + resync', () => {
  it('event realtime INSERT incrémente le compteur sans re-render parent', () => {
    render(<DashboardClient data={makeData({ ordersToday: 3 })} />);
    expect(statCardSub("Commandes aujourd'hui")).toBe('3');

    // Simule un INSERT realtime via le callback capturé.
    act(() => {
      realtimeRef.cb?.();
    });
    expect(statCardSub("Commandes aujourd'hui")).toBe('4');

    act(() => {
      realtimeRef.cb?.();
    });
    expect(statCardSub("Commandes aujourd'hui")).toBe('5');
  });

  it('resync sur changement de prop ordersToday : repart du nouveau baseline serveur', () => {
    render(<DashboardClient data={makeData({ ordersToday: 3 })} />);
    act(() => {
      realtimeRef.cb?.();
    });
    expect(statCardSub("Commandes aujourd'hui")).toBe('4');

    // Nouveau snapshot serveur : ordersToday = 10 (le serveur a fetché
    // après plusieurs autres INSERTs qu'on n'avait pas vus). On repart de
    // cette vérité.
    render(<DashboardClient data={makeData({ ordersToday: 10 })} />);
    expect(statCardSub("Commandes aujourd'hui")).toBe('10');

    // L'incrément realtime continue depuis le nouveau baseline.
    act(() => {
      realtimeRef.cb?.();
    });
    expect(statCardSub("Commandes aujourd'hui")).toBe('11');
  });

  it('changement de prop hors-ordersToday ne reset PAS le compteur live', () => {
    render(<DashboardClient data={makeData({ ordersToday: 3, weekOffset: 0 })} />);
    act(() => {
      realtimeRef.cb?.();
    });
    expect(statCardSub("Commandes aujourd'hui")).toBe('4');

    // Le serveur renvoie un payload où ordersToday n'a pas bougé (même
    // jour, mais navigation semaine). Le compteur live ne doit pas être
    // reset par le useEffect — il ne se redéclenche que si data.ordersToday
    // change.
    render(<DashboardClient data={makeData({ ordersToday: 3, weekOffset: -1 })} />);
    expect(statCardSub("Commandes aujourd'hui")).toBe('4');
  });
});

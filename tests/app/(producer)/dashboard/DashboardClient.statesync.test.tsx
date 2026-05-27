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
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className}>
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
      { day: 'Lun 25', isToday: true, slots: [] },
      { day: 'Mar 26', isToday: false, slots: [] },
      { day: 'Mer 27', isToday: false, slots: [] },
      { day: 'Jeu 28', isToday: false, slots: [] },
      { day: 'Ven 29', isToday: false, slots: [] },
      { day: 'Sam 30', isToday: false, slots: [] },
      { day: 'Dim 31', isToday: false, slots: [] },
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
  // Le `weekPlanning` est rendu dans la section "Planning de la semaine"
  // sous forme de `<div>` enfants de la grille. On extrait le label (`day`)
  // depuis le premier enfant texte de chaque cellule.
  const cells = container.querySelectorAll('.grid.grid-cols-7 > div');
  return Array.from(cells)
    .map((c) => c.firstElementChild?.textContent?.trim() ?? '')
    .filter(Boolean);
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
      'Lun 25',
      'Mar 26',
      'Mer 27',
      'Jeu 28',
      'Ven 29',
      'Sam 30',
      'Dim 31',
    ]);

    // Simule la navigation soft : nouveau payload serveur.
    const next = makeData({
      weekOffset: -1,
      weekPeriodLabel: '18 – 24 mai',
      weekPlanning: [
        { day: 'Lun 18', isToday: false, slots: [] },
        { day: 'Mar 19', isToday: false, slots: [] },
        { day: 'Mer 20', isToday: false, slots: [] },
        { day: 'Jeu 21', isToday: false, slots: [] },
        { day: 'Ven 22', isToday: false, slots: [] },
        { day: 'Sam 23', isToday: false, slots: [] },
        { day: 'Dim 24', isToday: false, slots: [] },
      ],
    });
    render(<DashboardClient data={next} />);

    expect(weekNavigatorAttrs()).toEqual({ offset: '-1', label: '18 – 24 mai' });
    expect(planningDays()).toEqual([
      'Lun 18',
      'Mar 19',
      'Mer 20',
      'Jeu 21',
      'Ven 22',
      'Sam 23',
      'Dim 24',
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

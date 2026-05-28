// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

// Tests anti-régression du fix « state stale » (2026-05-27) : le
// DashboardClient consomme directement la prop `data` pour les éléments
// transverses (badges, alertes, planning), avec un useState isolé pour le
// compteur live `ordersToday` (incrémenté par les events realtime Supabase)
// et un useState isolé pour `weekIndex` (navigation swipe locale 2026-05-28,
// resync sur changement de prop `currentWeekIndex`).

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

// Mock minimal du WeekNavigator (mode "client" depuis 2026-05-28). On expose
// les props clés en data-attrs pour vérifier le câblage côté parent sans
// instancier la machinerie de transition (testée séparément dans le suite
// dédié WeekNavigator).
vi.mock('@/app/(producer)/_components/WeekNavigator', () => ({
  WeekNavigator: (props: Record<string, unknown>) => (
    <div
      data-testid="week-navigator"
      data-mode={String(props.mode ?? 'url')}
      data-current-index={String(props.currentIndex ?? '')}
      data-period-label={String(props.periodLabel ?? '')}
      data-home-index={String(props.homeIndex ?? '')}
      data-max-index={String(props.maxIndex ?? '')}
    />
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
  over: { isToday?: boolean; slots?: VerticalDay['slots'] } = {},
): VerticalDay {
  return {
    dateIso,
    dayLabel,
    isToday: over.isToday ?? false,
    slots: over.slots ?? [],
  };
}

// Génère une semaine de 7 jours fictifs à partir d'un jour de départ. Permet
// de construire les 10 semaines de `weekPlannings` sans verbosité.
function weekFrom(startIsoDay: string): VerticalDay[] {
  // startIsoDay = "YYYY-MM-DD" (lundi). On dérive les 6 autres jours.
  const days: VerticalDay[] = [];
  const labels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const base = new Date(`${startIsoDay}T00:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    days.push(makeDay(iso, `${labels[i]} ${d.getUTCDate()}`));
  }
  return days;
}

function makeData(over: Partial<DashboardData> = {}): DashboardData {
  const weekPlannings = [
    weekFrom('2026-05-18'), // index 0 = -1 semaine
    weekFrom('2026-05-25'), // index 1 = semaine courante
    weekFrom('2026-06-01'),
    weekFrom('2026-06-08'),
    weekFrom('2026-06-15'),
    weekFrom('2026-06-22'),
    weekFrom('2026-06-29'),
    weekFrom('2026-07-06'),
    weekFrom('2026-07-13'),
    weekFrom('2026-07-20'), // index 9 = +8 semaines
  ];
  const weekPeriodLabels = [
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
  ];
  return {
    producerId: 'p1',
    producerName: 'Ferme Test',
    firstName: 'Pierre',
    weekPlannings,
    weekPeriodLabels,
    currentWeekIndex: 1,
    ordersToday: 3,
    ordersYesterday: 2,
    revenueWeek: 100,
    revenueLastWeek: 80,
    rating: 0,
    reviewCount: 0,
    nextPickup: null,
    pendingOrders: [],
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

function weekNavigatorAttrs(): {
  mode: string;
  currentIndex: string;
  label: string;
  homeIndex: string;
  maxIndex: string;
} {
  const wn = container.querySelector('[data-testid="week-navigator"]') as HTMLElement;
  return {
    mode: wn.dataset.mode ?? '',
    currentIndex: wn.dataset.currentIndex ?? '',
    label: wn.dataset.periodLabel ?? '',
    homeIndex: wn.dataset.homeIndex ?? '',
    maxIndex: wn.dataset.maxIndex ?? '',
  };
}

function planningDays(): string[] {
  // Le `weekPlannings[currentWeekIndex]` est rendu via VerticalWeekCalendar,
  // qui produit une colonne `<div data-testid="planning-day-column"
  // data-date-iso="…">` par jour. On lit le data-date-iso (clé stable) pour
  // vérifier la propagation de prop, indépendamment du formatage du label.
  const cols = container.querySelectorAll('[data-testid="planning-day-column"]');
  return Array.from(cols).map((c) => (c as HTMLElement).dataset.dateIso ?? '');
}

describe('DashboardClient — câblage WeekNavigator client + grille initiale', () => {
  it('passe le WeekNavigator en mode client, sur l\'index courant, avec les bonnes bornes', () => {
    render(<DashboardClient data={makeData()} />);
    expect(weekNavigatorAttrs()).toEqual({
      mode: 'client',
      currentIndex: '1',
      label: '25 – 31 mai',
      homeIndex: '1',
      maxIndex: '9',
    });
    // La grille rend la semaine courante (index 1) par défaut.
    expect(planningDays()).toEqual([
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
      '2026-05-28',
      '2026-05-29',
      '2026-05-30',
      '2026-05-31',
    ]);
  });

  it('un nouveau payload serveur (ex. minuit + 1 → semaine courante décalée) reset l\'index sur le nouveau currentWeekIndex', () => {
    const initial = makeData();
    render(<DashboardClient data={initial} />);

    // Le serveur reconstruit ses 10 semaines décalées d'une semaine (la
    // « semaine courante » a changé). On simule en remplaçant entièrement
    // weekPlannings + weekPeriodLabels ; currentWeekIndex reste 1 par
    // convention mais pointe sur la nouvelle semaine.
    const shifted = makeData({
      weekPlannings: [
        weekFrom('2026-05-25'),
        weekFrom('2026-06-01'), // nouvelle semaine courante
        weekFrom('2026-06-08'),
        weekFrom('2026-06-15'),
        weekFrom('2026-06-22'),
        weekFrom('2026-06-29'),
        weekFrom('2026-07-06'),
        weekFrom('2026-07-13'),
        weekFrom('2026-07-20'),
        weekFrom('2026-07-27'),
      ],
      weekPeriodLabels: [
        '25 – 31 mai',
        '1 – 7 juin',
        '8 – 14 juin',
        '15 – 21 juin',
        '22 – 28 juin',
        '29 juin – 5 juillet',
        '6 – 12 juillet',
        '13 – 19 juillet',
        '20 – 26 juillet',
        '27 juillet – 2 août',
      ],
    });
    render(<DashboardClient data={shifted} />);

    expect(weekNavigatorAttrs().label).toBe('1 – 7 juin');
    expect(planningDays()[0]).toBe('2026-06-01');
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

    // Nouveau snapshot serveur : ordersToday = 10. On repart de cette vérité.
    render(<DashboardClient data={makeData({ ordersToday: 10 })} />);
    expect(statCardSub("Commandes aujourd'hui")).toBe('10');

    // L'incrément realtime continue depuis le nouveau baseline.
    act(() => {
      realtimeRef.cb?.();
    });
    expect(statCardSub("Commandes aujourd'hui")).toBe('11');
  });

  it('changement de prop hors-ordersToday ne reset PAS le compteur live', () => {
    render(<DashboardClient data={makeData({ ordersToday: 3 })} />);
    act(() => {
      realtimeRef.cb?.();
    });
    expect(statCardSub("Commandes aujourd'hui")).toBe('4');

    // Le serveur renvoie un payload où ordersToday n'a pas bougé (même
    // jour). Le compteur live ne doit pas être reset par le useEffect — il ne
    // se redéclenche que si data.ordersToday change.
    render(
      <DashboardClient
        data={makeData({ ordersToday: 3, firstName: 'Pierre-le-resync' })}
      />,
    );
    expect(statCardSub("Commandes aujourd'hui")).toBe('4');
  });
});

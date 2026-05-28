// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Tests d'interactions de WeekNavigator en jsdom (clic intercepté +
// isPending visuel). Le fichier SSR voisin (WeekNavigator.test.tsx)
// reste dédié au rendu pur et au calcul des `href` — pas de mock
// du router.

const { pushMock, currentPathnameRef, currentParamsRef } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  currentPathnameRef: { value: '/dashboard' },
  currentParamsRef: { value: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathnameRef.value,
  useSearchParams: () => currentParamsRef.value,
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
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

import { WeekNavigator } from '@/app/(producer)/_components/WeekNavigator';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  pushMock.mockReset();
  currentPathnameRef.value = '/dashboard';
  currentParamsRef.value = new URLSearchParams();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(node: React.ReactElement) {
  act(() => root.render(node));
}

function arrow(
  label: 'Semaine précédente' | 'Semaine suivante',
): HTMLElement | null {
  // En mode URL (legacy) → <a>. En mode client → <button>. On retourne le
  // HTMLElement générique : dispatchEvent fonctionne sur les deux.
  return container.querySelector(`[aria-label="${label}"]`);
}

function periodLabelEl(): HTMLDivElement {
  // Le label est le premier <div> avec la classe text-[13px] dans le bloc
  // central. On scanne via le bloc qui contient `tabular-nums`.
  const el = container.querySelector('.tabular-nums') as HTMLDivElement | null;
  if (!el) throw new Error('Period label not found');
  return el;
}

describe('WeekNavigator — interactions clic (mode autonome, fallback /revenus)', () => {
  it('clic gauche standard : preventDefault + router.push + pas de navigation native', () => {
    render(<WeekNavigator weekOffset={0} periodLabel="25 – 31 mai" />);
    const prev = arrow('Semaine précédente');
    expect(prev).not.toBeNull();

    // React utilise event delegation au niveau du root container : son
    // onClick handler se déclenche en bubble APRÈS un éventuel listener
    // natif attaché à l'élément. On lit `defaultPrevented` directement
    // sur l'event après le dispatch — c'est l'état final.
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      prev!.dispatchEvent(evt);
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/dashboard?week=-1');
    expect(evt.defaultPrevented).toBe(true);
  });

  it('Cmd+clic : ne capture pas le clic (navigation native préservée)', () => {
    render(<WeekNavigator weekOffset={0} periodLabel="25 – 31 mai" />);
    const prev = arrow('Semaine précédente')!;

    const evt = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    act(() => {
      prev.dispatchEvent(evt);
    });

    expect(pushMock).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });

  it('middle click (button=1) : ne capture pas (open-in-new-tab préservé)', () => {
    render(<WeekNavigator weekOffset={0} periodLabel="25 – 31 mai" />);
    const prev = arrow('Semaine précédente')!;

    const evt = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    act(() => {
      prev.dispatchEvent(evt);
    });

    expect(pushMock).not.toHaveBeenCalled();
    expect(evt.defaultPrevented).toBe(false);
  });
});

// Mode "client" (swipe pré-chargé /dashboard 2026-05-28) : la navigation
// pilote un index local via `onIndexChange`, sans router.push ni `<Link>`.
// Les bornes et le bouton "Revenir à cette semaine" sont contrôlés
// explicitement par le parent (currentIndex / minIndex / maxIndex / homeIndex).
describe('WeekNavigator — mode client (swipe local)', () => {
  it('flèches : appellent onIndexChange(prev/next), pas router.push', () => {
    const onIndexChange = vi.fn();
    render(
      <WeekNavigator
        mode="client"
        currentIndex={1}
        minIndex={0}
        maxIndex={9}
        homeIndex={1}
        periodLabel="25 – 31 mai"
        onIndexChange={onIndexChange}
      />,
    );
    act(() => {
      arrow('Semaine suivante')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    act(() => {
      arrow('Semaine précédente')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onIndexChange).toHaveBeenNthCalledWith(1, 2);
    expect(onIndexChange).toHaveBeenNthCalledWith(2, 0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('borne basse : flèche précédente non cliquable à minIndex', () => {
    const onIndexChange = vi.fn();
    render(
      <WeekNavigator
        mode="client"
        currentIndex={0}
        minIndex={0}
        maxIndex={9}
        homeIndex={1}
        periodLabel="18 – 24 mai"
        onIndexChange={onIndexChange}
      />,
    );
    // Pas de <button> ‹ — le composant rend un <span aria-hidden>.
    expect(arrow('Semaine précédente')).toBeNull();
    // Flèche suivante toujours cliquable.
    act(() => {
      arrow('Semaine suivante')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('borne haute : flèche suivante non cliquable à maxIndex', () => {
    const onIndexChange = vi.fn();
    render(
      <WeekNavigator
        mode="client"
        currentIndex={9}
        minIndex={0}
        maxIndex={9}
        homeIndex={1}
        periodLabel="20 – 26 juillet"
        onIndexChange={onIndexChange}
      />,
    );
    expect(arrow('Semaine suivante')).toBeNull();
    act(() => {
      arrow('Semaine précédente')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onIndexChange).toHaveBeenCalledWith(8);
  });

  it('« Revenir à cette semaine » → onIndexChange(homeIndex)', () => {
    const onIndexChange = vi.fn();
    render(
      <WeekNavigator
        mode="client"
        currentIndex={4}
        minIndex={0}
        maxIndex={9}
        homeIndex={1}
        periodLabel="15 – 21 juin"
        onIndexChange={onIndexChange}
      />,
    );
    // Le bouton est rendu en tant que <button> texte.
    const homeBtn = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent === 'Revenir à cette semaine') as
      | HTMLButtonElement
      | undefined;
    expect(homeBtn).toBeDefined();
    act(() => {
      homeBtn!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('sur homeIndex : pas de bouton « Revenir à cette semaine », mention « Cette semaine »', () => {
    render(
      <WeekNavigator
        mode="client"
        currentIndex={1}
        minIndex={0}
        maxIndex={9}
        homeIndex={1}
        periodLabel="25 – 31 mai"
        onIndexChange={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('Cette semaine');
    expect(container.textContent).not.toContain('Revenir à cette semaine');
  });

  it('aucun rendu <a href> en mode client (pas de Link, pas d\'URL touchée)', () => {
    render(
      <WeekNavigator
        mode="client"
        currentIndex={3}
        minIndex={0}
        maxIndex={9}
        homeIndex={1}
        periodLabel="8 – 14 juin"
        onIndexChange={vi.fn()}
      />,
    );
    // Les flèches doivent être des <button>, pas des <a>.
    const links = container.querySelectorAll('a[href]');
    expect(links).toHaveLength(0);
  });
});

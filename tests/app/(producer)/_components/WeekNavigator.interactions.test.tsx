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

function arrow(label: 'Semaine précédente' | 'Semaine suivante'): HTMLAnchorElement | null {
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

describe('WeekNavigator — contrôle externe (mode dashboard)', () => {
  it('onNavigate fourni : clic appelle onNavigate, pas router.push', () => {
    const onNavigate = vi.fn();
    render(
      <WeekNavigator
        weekOffset={0}
        periodLabel="25 – 31 mai"
        isPending={false}
        onNavigate={onNavigate}
      />,
    );
    const next = arrow('Semaine suivante')!;
    act(() => {
      next.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/dashboard?week=1');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('isPending=true : label en opacity-60, flèches pointer-events-none + aria-disabled', () => {
    render(
      <WeekNavigator
        weekOffset={-1}
        periodLabel="18 – 24 mai"
        isPending={true}
        onNavigate={vi.fn()}
      />,
    );
    const label = periodLabelEl();
    expect(label.className).toContain('opacity-60');

    const prev = arrow('Semaine précédente')!;
    const next = arrow('Semaine suivante')!;
    expect(prev.className).toContain('pointer-events-none');
    expect(next.className).toContain('pointer-events-none');
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBe('true');
  });

  it('isPending=false : pas d\'opacity-60 ni pointer-events-none', () => {
    render(
      <WeekNavigator
        weekOffset={0}
        periodLabel="25 – 31 mai"
        isPending={false}
        onNavigate={vi.fn()}
      />,
    );
    const label = periodLabelEl();
    expect(label.className).not.toContain('opacity-60');

    const prev = arrow('Semaine précédente')!;
    // La flèche garde sa transition-colors et son arrowEnabled, jamais
    // pointer-events-none en mode actif.
    expect(prev.className).not.toMatch(/\bpointer-events-none\b/);
    expect(prev.getAttribute('aria-disabled')).toBeNull();
  });
});

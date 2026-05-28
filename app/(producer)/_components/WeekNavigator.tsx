'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useTransition,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { MAX_WEEK_OFFSET, MIN_WEEK_OFFSET } from '@/lib/dates/week-navigation';

// Sélecteur prev/next pour naviguer dans le temps par semaine. Deux modes :
//
//   - mode "url" (défaut, legacy) — pilote le query param `?week=` via
//     <Link> + router.push wrappé dans startTransition. Utilisé par /revenus
//     et /creneaux : la page entière re-fetch ses données sur navigation
//     (`weekOffset` et `periodLabel` viennent du serveur). Modifier-keys et
//     middle click préservent le comportement natif du <Link>
//     (open-in-new-tab, etc.).
//
//   - mode "client" — navigation 100 % côté client par index borné, sans
//     toucher à l'URL ni au router. Utilisé par /dashboard (2026-05-28) :
//     10 semaines pré-chargées, swipe instantané sans rechargement. Le
//     parent fournit l'index courant + ses bornes + un callback
//     `onIndexChange`.

type UrlModeProps = {
  mode?: 'url';
  /** Offset courant (0 = semaine en cours, négatif = passé). */
  weekOffset: number;
  /** Libellé de la période affichée (ex. « 19 – 25 mai »). */
  periodLabel: string;
};

type ClientModeProps = {
  mode: 'client';
  /** Index courant dans le tableau pré-chargé. */
  currentIndex: number;
  /** Index minimum atteignable (inclus, généralement 0). */
  minIndex: number;
  /** Index maximum atteignable (inclus, généralement length - 1). */
  maxIndex: number;
  /** Index considéré comme « semaine courante » (cible du bouton de retour). */
  homeIndex: number;
  /** Libellé pré-calculé de la semaine en cours d'affichage. */
  periodLabel: string;
  /** Callback déclenché par les flèches et le retour à la semaine courante. */
  onIndexChange: (next: number) => void;
};

type WeekNavigatorProps = UrlModeProps | ClientModeProps;

function isClientMode(props: WeekNavigatorProps): props is ClientModeProps {
  return props.mode === 'client';
}

const ARROW_BASE =
  'flex items-center justify-center w-9 h-9 rounded-lg border text-[16px] transition-colors';
const ARROW_ENABLED =
  'border-dark/[0.12] text-green-900 hover:bg-green-100/50 hover:border-green-500';
const ARROW_DISABLED =
  'border-dark/[0.06] text-dark/25 pointer-events-none';

export function WeekNavigator(props: WeekNavigatorProps) {
  if (isClientMode(props)) {
    return <WeekNavigatorClient {...props} />;
  }
  return <WeekNavigatorUrl {...props} />;
}

// --- Mode URL : navigation serveur via `?week=` (legacy /revenus + /creneaux) -

function WeekNavigatorUrl({ weekOffset, periodLabel }: UrlModeProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function hrefForOffset(offset: number): string {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (offset === 0) {
      params.delete('week');
    } else {
      params.set('week', String(offset));
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function handleClick(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    startTransition(() => {
      router.push(href);
    });
  }

  const prevOffset = weekOffset - 1;
  const nextOffset = weekOffset + 1;
  const canGoPrev = prevOffset >= MIN_WEEK_OFFSET;
  const canGoNext = nextOffset <= MAX_WEEK_OFFSET;

  const arrowPending = isPending ? 'pointer-events-none' : '';

  return (
    <Shell
      isPending={isPending}
      periodLabel={periodLabel}
      isHome={weekOffset === 0}
      homeLink={
        weekOffset !== 0 ? (
          <Link
            href={hrefForOffset(0)}
            onClick={(e) => handleClick(e, hrefForOffset(0))}
            aria-disabled={isPending || undefined}
            className={`text-[11px] text-terra-700 hover:text-terra-700/70 font-medium ${
              isPending ? 'pointer-events-none' : ''
            }`}
          >
            Revenir à cette semaine
          </Link>
        ) : null
      }
      prevArrow={
        canGoPrev ? (
          <Link
            href={hrefForOffset(prevOffset)}
            onClick={(e) => handleClick(e, hrefForOffset(prevOffset))}
            aria-label="Semaine précédente"
            aria-disabled={isPending || undefined}
            className={`${ARROW_BASE} ${ARROW_ENABLED} ${arrowPending}`}
          >
            ‹
          </Link>
        ) : (
          <DisabledArrow direction="prev" />
        )
      }
      nextArrow={
        canGoNext ? (
          <Link
            href={hrefForOffset(nextOffset)}
            onClick={(e) => handleClick(e, hrefForOffset(nextOffset))}
            aria-label="Semaine suivante"
            aria-disabled={isPending || undefined}
            className={`${ARROW_BASE} ${ARROW_ENABLED} ${arrowPending}`}
          >
            ›
          </Link>
        ) : (
          <DisabledArrow direction="next" />
        )
      }
    />
  );
}

// --- Mode client : navigation locale par index, zéro réseau, zéro URL --------

function WeekNavigatorClient({
  currentIndex,
  minIndex,
  maxIndex,
  homeIndex,
  periodLabel,
  onIndexChange,
}: ClientModeProps) {
  const canGoPrev = currentIndex - 1 >= minIndex;
  const canGoNext = currentIndex + 1 <= maxIndex;
  const isHome = currentIndex === homeIndex;

  function goto(next: number) {
    if (next < minIndex || next > maxIndex || next === currentIndex) return;
    onIndexChange(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, target: number) {
    // Espace/Entrée natifs sur <button> — pas besoin de capter. On capte juste
    // les flèches gauche/droite pour cohérence avec un usage clavier rapide.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      goto(target);
    }
  }

  return (
    <Shell
      isPending={false}
      periodLabel={periodLabel}
      isHome={isHome}
      homeLink={
        !isHome ? (
          <button
            type="button"
            onClick={() => goto(homeIndex)}
            className="text-[11px] text-terra-700 hover:text-terra-700/70 font-medium"
          >
            Revenir à cette semaine
          </button>
        ) : null
      }
      prevArrow={
        canGoPrev ? (
          <button
            type="button"
            onClick={() => goto(currentIndex - 1)}
            onKeyDown={(e) => onKeyDown(e, currentIndex - 1)}
            aria-label="Semaine précédente"
            className={`${ARROW_BASE} ${ARROW_ENABLED}`}
          >
            ‹
          </button>
        ) : (
          <DisabledArrow direction="prev" />
        )
      }
      nextArrow={
        canGoNext ? (
          <button
            type="button"
            onClick={() => goto(currentIndex + 1)}
            onKeyDown={(e) => onKeyDown(e, currentIndex + 1)}
            aria-label="Semaine suivante"
            className={`${ARROW_BASE} ${ARROW_ENABLED}`}
          >
            ›
          </button>
        ) : (
          <DisabledArrow direction="next" />
        )
      }
    />
  );
}

// --- Coquille visuelle partagée ----------------------------------------------

function Shell({
  isPending,
  periodLabel,
  isHome,
  homeLink,
  prevArrow,
  nextArrow,
}: {
  isPending: boolean;
  periodLabel: string;
  isHome: boolean;
  homeLink: ReactNode;
  prevArrow: ReactNode;
  nextArrow: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {prevArrow}
      <div className="text-center min-w-[150px]">
        <div
          className={`text-[13px] font-semibold text-green-900 tabular-nums transition-opacity ${
            isPending ? 'opacity-60' : ''
          }`}
        >
          {periodLabel}
        </div>
        {isHome ? (
          <div className="text-[11px] text-dark/45 font-medium">Cette semaine</div>
        ) : (
          homeLink
        )}
      </div>
      {nextArrow}
    </div>
  );
}

function DisabledArrow({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <span aria-hidden="true" className={`${ARROW_BASE} ${ARROW_DISABLED}`}>
      {direction === 'prev' ? '‹' : '›'}
    </span>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition, type MouseEvent } from 'react';
import { MAX_WEEK_OFFSET, MIN_WEEK_OFFSET } from '@/lib/dates/week-navigation';

type WeekNavigatorProps = {
  /** Offset courant (0 = semaine en cours, négatif = passé). */
  weekOffset: number;
  /** Libellé de la période affichée (ex. « 19 – 25 mai »). */
  periodLabel: string;
  /**
   * Contrôle externe optionnel de la transition. Quand fournis, le parent
   * (ex. DashboardClient) pilote la navigation et peut propager `isPending`
   * à d'autres zones (grille planning) pour un feedback visuel étendu.
   * Sinon, le composant gère sa propre transition locale (cas /revenus).
   */
  isPending?: boolean;
  onNavigate?: (href: string) => void;
};

/**
 * Sélecteur prev/next pour naviguer dans le temps par semaine
 * (chantier 10). Pilote le query param `?week=` en préservant les autres
 * params.
 *
 * Comportement de navigation :
 *   - clic gauche standard → `router.push` wrappé dans `startTransition`
 *     (ou délégué au parent via `onNavigate`). Pendant la transition, les
 *     flèches sont neutralisées (`pointer-events-none` + `aria-disabled`)
 *     pour éviter qu'un double-clic rapide ne calcule des offsets depuis
 *     une prop figée (la prop `weekOffset` ne se met à jour qu'après la
 *     re-render serveur). Le label passe en `opacity-60` pour signaler
 *     la transition.
 *   - modifier keys (Cmd/Ctrl/Shift/Alt) ou middle click → navigation
 *     native du `<Link>` préservée (open-in-new-tab, etc.).
 */
export function WeekNavigator({
  weekOffset,
  periodLabel,
  isPending: isPendingProp,
  onNavigate,
}: WeekNavigatorProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [isPendingLocal, startTransition] = useTransition();

  const externallyControlled = isPendingProp !== undefined || onNavigate !== undefined;
  const isPending = externallyControlled ? Boolean(isPendingProp) : isPendingLocal;

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
    if (onNavigate) {
      onNavigate(href);
      return;
    }
    startTransition(() => {
      router.push(href);
    });
  }

  const prevOffset = weekOffset - 1;
  const nextOffset = weekOffset + 1;
  const canGoPrev = prevOffset >= MIN_WEEK_OFFSET;
  const canGoNext = nextOffset <= MAX_WEEK_OFFSET;

  const arrowBase =
    'flex items-center justify-center w-9 h-9 rounded-lg border text-[16px] transition-colors';
  const arrowEnabled =
    'border-dark/[0.12] text-green-900 hover:bg-green-100/50 hover:border-green-500';
  const arrowDisabled =
    'border-dark/[0.06] text-dark/25 pointer-events-none';
  const arrowPending = isPending ? 'pointer-events-none' : '';

  return (
    <div className="flex items-center gap-3">
      {canGoPrev ? (
        <Link
          href={hrefForOffset(prevOffset)}
          onClick={(e) => handleClick(e, hrefForOffset(prevOffset))}
          aria-label="Semaine précédente"
          aria-disabled={isPending || undefined}
          className={`${arrowBase} ${arrowEnabled} ${arrowPending}`}
        >
          ‹
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={`${arrowBase} ${arrowDisabled}`}
        >
          ‹
        </span>
      )}

      <div className="text-center min-w-[150px]">
        <div
          className={`text-[13px] font-semibold text-green-900 tabular-nums transition-opacity ${
            isPending ? 'opacity-60' : ''
          }`}
        >
          {periodLabel}
        </div>
        {weekOffset !== 0 && (
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
        )}
        {weekOffset === 0 && (
          <div className="text-[11px] text-dark/45 font-medium">Cette semaine</div>
        )}
      </div>

      {canGoNext ? (
        <Link
          href={hrefForOffset(nextOffset)}
          onClick={(e) => handleClick(e, hrefForOffset(nextOffset))}
          aria-label="Semaine suivante"
          aria-disabled={isPending || undefined}
          className={`${arrowBase} ${arrowEnabled} ${arrowPending}`}
        >
          ›
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={`${arrowBase} ${arrowDisabled}`}
        >
          ›
        </span>
      )}
    </div>
  );
}

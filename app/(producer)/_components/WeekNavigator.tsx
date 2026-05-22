'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { MAX_WEEK_OFFSET, MIN_WEEK_OFFSET } from '@/lib/dates/week-navigation';

type WeekNavigatorProps = {
  /** Offset courant (0 = semaine en cours, négatif = passé). */
  weekOffset: number;
  /** Libellé de la période affichée (ex. « 19 – 25 mai »). */
  periodLabel: string;
};

/**
 * Sélecteur prev/next pour naviguer dans le temps par semaine
 * (chantier 10). Pilote le query param `?week=` en préservant les autres
 * params. Pas d'état React : chaque flèche est un `Link` SSR-friendly vers
 * l'offset voisin, le Server Component re-fetch les bonnes données.
 */
export function WeekNavigator({ weekOffset, periodLabel }: WeekNavigatorProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

  return (
    <div className="flex items-center gap-3">
      {canGoPrev ? (
        <Link
          href={hrefForOffset(prevOffset)}
          aria-label="Semaine précédente"
          className={`${arrowBase} ${arrowEnabled}`}
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
        <div className="text-[13px] font-semibold text-green-900 tabular-nums">
          {periodLabel}
        </div>
        {weekOffset !== 0 && (
          <Link
            href={hrefForOffset(0)}
            className="text-[11px] text-terra-700 hover:text-terra-700/70 font-medium"
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
          aria-label="Semaine suivante"
          className={`${arrowBase} ${arrowEnabled}`}
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

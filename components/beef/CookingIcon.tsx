import type { SVGProps } from 'react';

/**
 * Choisit une icone simple en fonction du label de cuisson.
 * Pas de mapping exhaustif — on utilise des marqueurs visuels generiques.
 */
function pickIcon(label: string): 'flame' | 'disk' | 'oven' | 'pot' | 'cold' {
  const lower = label.toLowerCase();
  if (
    /(grill|barbec|brochet|saign)/.test(lower) ||
    /(grillade|plancha)/.test(lower) === false &&
      /(grille|saisi|flamme)/.test(lower)
  ) {
    return 'flame';
  }
  if (/plancha/.test(lower)) return 'disk';
  if (/(four|roti|rosbif)/.test(lower)) return 'oven';
  if (
    /(mijot|bourguignon|daube|pot-au-feu|pot au feu|braise|braisee|bouill|carbonnade|hochepot|osso|fume|saumure|poch)/.test(
      lower,
    )
  ) {
    return 'pot';
  }
  if (/(carpaccio|tartare|cru)/.test(lower)) return 'cold';
  if (/(poele|escalope|tournedos|rossini|pave)/.test(lower)) return 'flame';
  return 'flame';
}

export function CookingIcon({
  label,
  ...rest
}: { label: string } & SVGProps<SVGSVGElement>) {
  const variant = pickIcon(label);
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };

  switch (variant) {
    case 'flame':
      return (
        <svg {...common}>
          <path d="M3 12 Q 6 8 12 12 Q 18 16 21 12" />
          <path d="M3 17 Q 6 13 12 17 Q 18 21 21 17" />
          <path d="M6 5 L 6 7" />
          <path d="M12 5 L 12 7" />
          <path d="M18 5 L 18 7" />
        </svg>
      );
    case 'disk':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
          <path d="M2 12 L 5 12" />
          <path d="M19 12 L 22 12" />
        </svg>
      );
    case 'oven':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="14" rx="2" />
          <path d="M3 11 L 21 11" />
          <circle cx="7" cy="8.5" r="0.6" fill="currentColor" />
          <circle cx="12" cy="8.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'pot':
      return (
        <svg {...common}>
          <path d="M5 9 L 19 9 L 18 19 Q 18 20 17 20 L 7 20 Q 6 20 6 19 Z" />
          <path d="M3 9 L 21 9" />
          <path d="M9 5 Q 9 7 11 7" />
          <path d="M13 4 Q 13 6 15 6" />
        </svg>
      );
    case 'cold':
      return (
        <svg {...common}>
          <path d="M12 3 L 12 21" />
          <path d="M5 7 L 19 17" />
          <path d="M5 17 L 19 7" />
        </svg>
      );
  }
}

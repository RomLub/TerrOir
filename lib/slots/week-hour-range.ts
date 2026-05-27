import { TZDate } from '@date-fns/tz';

// Calcule l'amplitude horaire min/max d'une semaine de slots, en heure
// Europe/Paris. Sert à aligner les 7 colonnes du bandeau Planning
// (dashboard producteur) sur une échelle commune, indépendamment des
// horaires d'ouverture du jour le plus court.
//
// La conversion Paris (vs UTC) est cruciale au passage à l'heure : un slot
// `starts_at = 2026-03-29T05:00:00Z` est 6h Paris en hiver, 7h Paris en été.
// On lit toujours l'heure locale Paris pour ne pas glisser au DST.

const TZ = 'Europe/Paris';

/**
 * Fallback affiché quand la semaine consultée n'a aucun slot exploitable
 * (producteur fermé toute la semaine, ou semaine entièrement passée). On
 * choisit une amplitude métier raisonnable [8h, 20h] plutôt qu'une plage
 * dégénérée qui rendrait la grille illisible.
 */
export const PLANNING_FALLBACK_RANGE = { startHour: 8, endHour: 20 } as const;

type SlotLike = { starts_at: string; ends_at: string };

/**
 * Heure décimale Paris (ex: 9h30 → 9.5) d'une date ISO. Les minutes sont
 * conservées en fraction — on arrondira au niveau du composant si besoin.
 */
function hourFracInParis(iso: string): number {
  const d = new TZDate(iso, TZ);
  return d.getHours() + d.getMinutes() / 60;
}

/**
 * Calcule l'amplitude horaire entière qui couvre tous les slots fournis :
 *   - `startHour` = floor(min des starts_at, en heure Paris)
 *   - `endHour`   = ceil(max des ends_at, en heure Paris)
 * Clamped dans [0, 24]. Fallback PLANNING_FALLBACK_RANGE si tableau vide.
 *
 * Un slot qui chevauche minuit (ex: 22h-2h le lendemain) n'arrive jamais en
 * pratique côté TerrOir (les rules sont contraintes `end_time > start_time`
 * et le picker producteur ne propose pas de plage nocturne). On clamp tout
 * de même à 24 pour blinder.
 */
export function computeWeekHourRange(
  slots: ReadonlyArray<SlotLike>,
): { startHour: number; endHour: number } {
  if (slots.length === 0) return PLANNING_FALLBACK_RANGE;

  let minFrac = Infinity;
  let maxFrac = -Infinity;
  for (const s of slots) {
    const start = hourFracInParis(s.starts_at);
    const end = hourFracInParis(s.ends_at);
    if (start < minFrac) minFrac = start;
    if (end > maxFrac) maxFrac = end;
  }

  const startHour = Math.max(0, Math.floor(minFrac));
  const endHour = Math.min(24, Math.ceil(maxFrac));

  // Garde-fou : si tous les slots ont fini à une heure pile, ceil produit la
  // même valeur que la part entière → on garantit au moins 1h d'amplitude.
  if (endHour <= startHour) {
    return { startHour, endHour: Math.min(24, startHour + 1) };
  }

  return { startHour, endHour };
}

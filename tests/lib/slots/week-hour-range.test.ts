import { describe, it, expect } from 'vitest';
import {
  computeWeekHourRange,
  PLANNING_FALLBACK_RANGE,
} from '@/lib/slots/week-hour-range';

// Helpers pour construire des ISO timestamps en heure Paris. On passe par
// l'heure UTC équivalente (notation Z) calculée à la main pour rester
// indépendant du fuseau de la machine qui exécute les tests.

/** ISO d'une heure locale Paris en hiver (UTC+1). */
function parisWinter(date: string, time: string): string {
  return `${date}T${time}+01:00`;
}

/** ISO d'une heure locale Paris en été (UTC+2). */
function parisSummer(date: string, time: string): string {
  return `${date}T${time}+02:00`;
}

describe('computeWeekHourRange', () => {
  it('tableau vide → fallback [8, 20]', () => {
    expect(computeWeekHourRange([])).toEqual(PLANNING_FALLBACK_RANGE);
    expect(PLANNING_FALLBACK_RANGE).toEqual({ startHour: 8, endHour: 20 });
  });

  it('un seul slot 9h30-12h Paris (hiver) → [9, 12]', () => {
    expect(
      computeWeekHourRange([
        {
          starts_at: parisWinter('2026-01-15', '09:30:00'),
          ends_at: parisWinter('2026-01-15', '12:00:00'),
        },
      ]),
    ).toEqual({ startHour: 9, endHour: 12 });
  });

  it('plusieurs slots span large → englobe min/max et arrondit', () => {
    const slots = [
      {
        starts_at: parisWinter('2026-01-15', '07:15:00'),
        ends_at: parisWinter('2026-01-15', '09:00:00'),
      },
      {
        starts_at: parisWinter('2026-01-16', '18:30:00'),
        ends_at: parisWinter('2026-01-16', '20:45:00'),
      },
      {
        starts_at: parisWinter('2026-01-17', '14:00:00'),
        ends_at: parisWinter('2026-01-17', '16:00:00'),
      },
    ];
    // min start = 7:15 → floor 7 ; max end = 20:45 → ceil 21.
    expect(computeWeekHourRange(slots)).toEqual({ startHour: 7, endHour: 21 });
  });

  it('heures pleines : ne sur-arrondit pas le ceil sur un end pile à 18h', () => {
    // 18:00 pile → ceil(18) = 18. On ne veut pas un endHour à 19 par excès.
    expect(
      computeWeekHourRange([
        {
          starts_at: parisWinter('2026-01-15', '09:00:00'),
          ends_at: parisWinter('2026-01-15', '18:00:00'),
        },
      ]),
    ).toEqual({ startHour: 9, endHour: 18 });
  });

  it('amplitude inférieure à 1h : élargit à au moins 1h pour ne pas dégénérer', () => {
    // start 9:15, end 9:45 → floor 9 / ceil 10. Bien, naturel.
    expect(
      computeWeekHourRange([
        {
          starts_at: parisWinter('2026-01-15', '09:15:00'),
          ends_at: parisWinter('2026-01-15', '09:45:00'),
        },
      ]),
    ).toEqual({ startHour: 9, endHour: 10 });

    // Cas pathologique : start = end (slot dégénéré, ne devrait jamais arriver
    // — la contrainte SQL slots_time_window l'interdit — mais garde-fou utile).
    expect(
      computeWeekHourRange([
        {
          starts_at: parisWinter('2026-01-15', '09:00:00'),
          ends_at: parisWinter('2026-01-15', '09:00:00'),
        },
      ]),
    ).toEqual({ startHour: 9, endHour: 10 });
  });

  it("DST printemps (2026-03-29) : lit l'heure locale Paris, pas UTC", () => {
    // Le 2026-03-29 à 2h Paris l'heure saute à 3h (passage UTC+1 → UTC+2).
    // Un slot 09:00-12:00 Paris ce jour-là vit en heure d'été (UTC+2).
    // Le résultat doit être [9, 12], pas [10, 13] (off-by-one TZ).
    expect(
      computeWeekHourRange([
        {
          starts_at: parisSummer('2026-03-29', '09:00:00'),
          ends_at: parisSummer('2026-03-29', '12:00:00'),
        },
      ]),
    ).toEqual({ startHour: 9, endHour: 12 });
  });

  it("DST automne (2026-10-25) : lit l'heure locale Paris, pas UTC", () => {
    // Le 2026-10-25 à 3h Paris l'heure recule à 2h (UTC+2 → UTC+1). Un slot
    // 09:00-12:00 Paris ce jour-là vit en heure d'hiver (UTC+1).
    expect(
      computeWeekHourRange([
        {
          starts_at: parisWinter('2026-10-25', '09:00:00'),
          ends_at: parisWinter('2026-10-25', '12:00:00'),
        },
      ]),
    ).toEqual({ startHour: 9, endHour: 12 });
  });

  it('mix été + hiver dans une même fenêtre (impossible en pratique, mais robuste) : agrège les bornes', () => {
    const slots = [
      {
        starts_at: parisSummer('2026-03-29', '06:30:00'),
        ends_at: parisSummer('2026-03-29', '08:00:00'),
      },
      {
        starts_at: parisWinter('2026-10-25', '19:00:00'),
        ends_at: parisWinter('2026-10-25', '21:30:00'),
      },
    ];
    expect(computeWeekHourRange(slots)).toEqual({ startHour: 6, endHour: 22 });
  });
});

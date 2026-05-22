import { describe, it, expect } from 'vitest';
import {
  parseWeekOffset,
  startOfWeek,
  addDays,
  startOfDay,
  weekStartForOffset,
  computeDashboardBounds,
  computeRevenueWeekWindow,
  formatWeekRangeLabel,
  MAX_WEEK_OFFSET,
  MIN_WEEK_OFFSET,
} from '@/lib/dates/week-navigation';

// Référence stable pour les calculs : jeudi 22 mai 2026, 14h30 (heure locale
// du runner). La semaine ISO de ce jour démarre lundi 18 mai 2026.
const REF = new Date(2026, 4, 22, 14, 30, 0); // mai = index 4

describe('parseWeekOffset', () => {
  it('absent / undefined → 0', () => {
    expect(parseWeekOffset(undefined)).toBe(0);
  });

  it('chaîne vide ou espaces → 0', () => {
    expect(parseWeekOffset('')).toBe(0);
    expect(parseWeekOffset('   ')).toBe(0);
  });

  it('entier négatif valide → conservé', () => {
    expect(parseWeekOffset('-1')).toBe(-1);
    expect(parseWeekOffset('-12')).toBe(-12);
  });

  it('entier positif valide → conservé', () => {
    expect(parseWeekOffset('3')).toBe(3);
  });

  it('décimal → tronqué vers zéro', () => {
    expect(parseWeekOffset('2.9')).toBe(2);
    expect(parseWeekOffset('-2.9')).toBe(-2);
  });

  it('non numérique → 0 (fail-safe)', () => {
    expect(parseWeekOffset('abc')).toBe(0);
    expect(parseWeekOffset('1abc')).toBe(0);
    expect(parseWeekOffset('NaN')).toBe(0);
    expect(parseWeekOffset('Infinity')).toBe(0);
  });

  it('tableau → première valeur', () => {
    expect(parseWeekOffset(['-2', '5'])).toBe(-2);
  });

  it('hors bornes → clampé', () => {
    expect(parseWeekOffset('999999')).toBe(MAX_WEEK_OFFSET);
    expect(parseWeekOffset('-999999')).toBe(MIN_WEEK_OFFSET);
    expect(parseWeekOffset(String(MAX_WEEK_OFFSET + 1))).toBe(MAX_WEEK_OFFSET);
    expect(parseWeekOffset(String(MIN_WEEK_OFFSET - 1))).toBe(MIN_WEEK_OFFSET);
  });

  it('aux bornes exactes → conservé', () => {
    expect(parseWeekOffset(String(MAX_WEEK_OFFSET))).toBe(MAX_WEEK_OFFSET);
    expect(parseWeekOffset(String(MIN_WEEK_OFFSET))).toBe(MIN_WEEK_OFFSET);
  });
});

describe('startOfWeek', () => {
  it('lundi comme début de semaine, heure remise à 00:00', () => {
    // 22 mai 2026 est un vendredi → lundi = 18 mai.
    const ws = startOfWeek(REF);
    expect(ws.getFullYear()).toBe(2026);
    expect(ws.getMonth()).toBe(4);
    expect(ws.getDate()).toBe(18);
    expect(ws.getDay()).toBe(1); // lundi
    expect(ws.getHours()).toBe(0);
    expect(ws.getMinutes()).toBe(0);
  });

  it('un lundi reste sur lui-même', () => {
    const monday = new Date(2026, 4, 18, 9, 0, 0);
    const ws = startOfWeek(monday);
    expect(ws.getDate()).toBe(18);
    expect(ws.getHours()).toBe(0);
  });

  it('un dimanche revient au lundi de la même semaine ISO', () => {
    const sunday = new Date(2026, 4, 24, 23, 0, 0);
    const ws = startOfWeek(sunday);
    expect(ws.getDate()).toBe(18);
  });

  it('ne mute pas la date source', () => {
    const src = new Date(2026, 4, 22, 14, 30, 0);
    const snapshot = src.getTime();
    startOfWeek(src);
    expect(src.getTime()).toBe(snapshot);
  });
});

describe('addDays / startOfDay', () => {
  it('addDays gère le passage de mois', () => {
    const d = addDays(new Date(2026, 4, 30), 3);
    expect(d.getMonth()).toBe(5); // juin
    expect(d.getDate()).toBe(2);
  });

  it('addDays négatif recule', () => {
    const d = addDays(new Date(2026, 4, 2), -3);
    expect(d.getMonth()).toBe(3); // avril
    expect(d.getDate()).toBe(29);
  });

  it('startOfDay remet 00:00', () => {
    const d = startOfDay(new Date(2026, 4, 22, 18, 45, 12));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(22);
  });
});

describe('weekStartForOffset', () => {
  it('offset 0 = semaine courante', () => {
    expect(weekStartForOffset(REF, 0).getDate()).toBe(18);
  });

  it('offset -1 = semaine précédente', () => {
    const ws = weekStartForOffset(REF, -1);
    expect(ws.getDate()).toBe(11);
  });

  it('offset +2 = deux semaines plus tard', () => {
    const ws = weekStartForOffset(REF, 2);
    expect(ws.getMonth()).toBe(5); // juin
    expect(ws.getDate()).toBe(1);
  });
});

describe('computeDashboardBounds', () => {
  it('offset 0 : week_start = lundi courant, ancres today = vrai jour', () => {
    const b = computeDashboardBounds(REF, 0);
    expect(b.weekStart.getDate()).toBe(18);
    expect(b.weekEnd.getDate()).toBe(25); // lundi suivant
    expect(b.lastWeekStart.getDate()).toBe(11);
    expect(b.todayStart.getDate()).toBe(22);
    expect(b.yesterdayStart.getDate()).toBe(21);
    expect(b.tomorrowStart.getDate()).toBe(23);
  });

  it('ancres today/yesterday/tomorrow restent au vrai now même avec offset', () => {
    const current = computeDashboardBounds(REF, 0);
    const past = computeDashboardBounds(REF, -3);
    // Les ancres « live » ne bougent pas avec l'offset.
    expect(past.todayStart.getTime()).toBe(current.todayStart.getTime());
    expect(past.yesterdayStart.getTime()).toBe(current.yesterdayStart.getTime());
    expect(past.tomorrowStart.getTime()).toBe(current.tomorrowStart.getTime());
    expect(past.todayIso).toBe(current.todayIso);
  });

  it('offset -1 : décale les bornes scopées semaine d\'une semaine', () => {
    const b = computeDashboardBounds(REF, -1);
    expect(b.weekStart.getDate()).toBe(11);
    expect(b.weekEnd.getDate()).toBe(18);
    expect(b.lastWeekStart.getDate()).toBe(4);
  });

  it('marge slots = 1 jour de part et d\'autre', () => {
    const b = computeDashboardBounds(REF, 0);
    expect(b.slotsRangeStart.getDate()).toBe(17); // weekStart - 1
    expect(b.slotsRangeEnd.getDate()).toBe(26); // weekEnd + 1
  });

  it('weekStartIso suit l\'offset, todayIso reste le vrai jour', () => {
    const b = computeDashboardBounds(REF, -1);
    expect(b.weekStartIso).toBe('2026-05-11');
    expect(b.weekEndIso).toBe('2026-05-18');
    expect(b.todayIso).toBe('2026-05-22');
  });
});

describe('computeRevenueWeekWindow', () => {
  it('offset 0 : 8 semaines terminant sur la semaine courante', () => {
    const w = computeRevenueWeekWindow(REF, 0);
    expect(w.weekStarts).toHaveLength(8);
    // dernière = semaine courante (lundi 18 mai)
    expect(w.weekStarts[7]!.getDate()).toBe(18);
    // première = 7 semaines avant
    expect(w.rangeStart.getTime()).toBe(w.weekStarts[0]!.getTime());
    expect(w.weekStarts[0]!.getTime()).toBe(addDays(w.weekStarts[7]!, -49).getTime());
  });

  it('ordre chronologique croissant', () => {
    const w = computeRevenueWeekWindow(REF, 0);
    for (let i = 1; i < w.weekStarts.length; i++) {
      expect(w.weekStarts[i]!.getTime()).toBeGreaterThan(
        w.weekStarts[i - 1]!.getTime(),
      );
    }
  });

  it('offset -1 : fenêtre décalée d\'une semaine vers le passé', () => {
    const base = computeRevenueWeekWindow(REF, 0);
    const past = computeRevenueWeekWindow(REF, -1);
    expect(past.weekStarts[7]!.getTime()).toBe(
      addDays(base.weekStarts[7]!, -7).getTime(),
    );
    expect(past.rangeEnd.getTime()).toBe(addDays(base.rangeEnd, -7).getTime());
  });

  it('rangeEnd = lundi suivant la semaine cible (borne haute exclusive)', () => {
    const w = computeRevenueWeekWindow(REF, 0);
    expect(w.rangeEnd.getDate()).toBe(25); // lundi 25 mai
  });
});

describe('formatWeekRangeLabel', () => {
  it('semaine dans un seul mois → « 18 – 24 mai »', () => {
    const ws = new Date(2026, 4, 18);
    expect(formatWeekRangeLabel(ws)).toBe('18 – 24 mai');
  });

  it('semaine à cheval sur deux mois → mentionne les deux mois', () => {
    // Lundi 27 avril 2026 → dimanche 3 mai 2026.
    const ws = new Date(2026, 3, 27);
    expect(formatWeekRangeLabel(ws)).toBe('27 avril – 3 mai');
  });

  it('utilise dimanche (start + 6) comme fin de semaine', () => {
    const ws = new Date(2026, 4, 11); // lundi
    expect(formatWeekRangeLabel(ws)).toBe('11 – 17 mai');
  });
});

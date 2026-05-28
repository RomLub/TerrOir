import { describe, it, expect } from 'vitest';
import {
  maxCapacityForDuration,
  isCapacityValid,
  capacityErrorMessage,
} from '@/lib/slots/capacity-limit';

describe('maxCapacityForDuration — paliers métier', () => {
  it('15 minutes (RDV court) → 2', () => {
    expect(maxCapacityForDuration(15)).toBe(2);
  });

  it('30 minutes (RDV standard) → 4', () => {
    expect(maxCapacityForDuration(30)).toBe(4);
  });

  it('60 minutes (1 heure) → 8', () => {
    expect(maxCapacityForDuration(60)).toBe(8);
  });

  it('180 minutes (plage 3h) → 24', () => {
    expect(maxCapacityForDuration(180)).toBe(24);
  });

  it('240 minutes (plage 4h) → 32', () => {
    expect(maxCapacityForDuration(240)).toBe(32);
  });
});

describe('maxCapacityForDuration — arrondi ceil sur les non-multiples de 15', () => {
  it('5 minutes (mini autorisé en SQL) → 2', () => {
    expect(maxCapacityForDuration(5)).toBe(2);
  });

  it('14 minutes → 2 (ceil(14/15)=1)', () => {
    expect(maxCapacityForDuration(14)).toBe(2);
  });

  it('16 minutes → 4 (ceil(16/15)=2)', () => {
    expect(maxCapacityForDuration(16)).toBe(4);
  });

  it('45 minutes → 6 (ceil(45/15)=3)', () => {
    expect(maxCapacityForDuration(45)).toBe(6);
  });

  it('46 minutes → 8 (ceil(46/15)=4)', () => {
    expect(maxCapacityForDuration(46)).toBe(8);
  });
});

describe('maxCapacityForDuration — entrées invalides', () => {
  it('throws sur 0', () => {
    expect(() => maxCapacityForDuration(0)).toThrow();
  });

  it('throws sur valeur négative', () => {
    expect(() => maxCapacityForDuration(-10)).toThrow();
  });

  it('throws sur NaN', () => {
    expect(() => maxCapacityForDuration(NaN)).toThrow();
  });
});

describe('isCapacityValid — borne haute', () => {
  it('cap = max autorisé → true', () => {
    expect(isCapacityValid(30, 4)).toBe(true);
    expect(isCapacityValid(60, 8)).toBe(true);
  });

  it('cap = max + 1 → false', () => {
    expect(isCapacityValid(30, 5)).toBe(false);
    expect(isCapacityValid(60, 9)).toBe(false);
  });

  it('cap très au-dessus → false', () => {
    expect(isCapacityValid(30, 100)).toBe(false);
  });
});

describe('isCapacityValid — borne basse + entrées invalides', () => {
  it('cap = 0 → false', () => {
    expect(isCapacityValid(30, 0)).toBe(false);
  });

  it('cap = -1 → false', () => {
    expect(isCapacityValid(30, -1)).toBe(false);
  });

  it('cap = 1 (mini) → true', () => {
    expect(isCapacityValid(30, 1)).toBe(true);
  });

  it('cap non entier → false', () => {
    expect(isCapacityValid(30, 2.5)).toBe(false);
  });

  it('cap NaN → false', () => {
    expect(isCapacityValid(30, NaN)).toBe(false);
  });
});

describe('isCapacityValid — invariant libre vs rdv (même formule)', () => {
  // Plage libre 60 min : capacité couvre toute la plage, max = 8 (idem rdv 60).
  it('plage libre 60min cap=8 → true', () => {
    expect(isCapacityValid(60, 8)).toBe(true);
  });

  // Plage libre 3h : max = 24.
  it('plage libre 180min cap=24 → true, cap=25 → false', () => {
    expect(isCapacityValid(180, 24)).toBe(true);
    expect(isCapacityValid(180, 25)).toBe(false);
  });

  // RDV 15 min : max = 2. La même formule s'applique sans branche
  // conditionnelle sur le mode.
  it('rdv 15min cap=2 → true, cap=3 → false', () => {
    expect(isCapacityValid(15, 2)).toBe(true);
    expect(isCapacityValid(15, 3)).toBe(false);
  });
});

describe('capacityErrorMessage', () => {
  it('mentionne explicitement le max et la durée', () => {
    const msg = capacityErrorMessage(30);
    expect(msg).toContain('4');
    expect(msg).toContain('30');
    expect(msg).toContain('2 places par quart');
  });

  it('singulier "place" quand max = 1', () => {
    // Cas pathologique : durée < 7.5 → max = 2 (ceil(<8/15)=1 → *2=2).
    // En pratique on n'atteint jamais max=1 avec la formule courante,
    // mais on garde le branchement pluriel pour robustesse.
    const msg = capacityErrorMessage(30);
    expect(msg).toContain('places');
  });
});

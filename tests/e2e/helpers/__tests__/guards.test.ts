import { describe, it, expect } from 'vitest';
import {
  assertSafeEmail,
  generateTestEmail,
  ProtectedEmailError,
  __TEST_ONLY__,
} from '../guards';

describe('assertSafeEmail', () => {
  describe('allow-list pattern', () => {
    it('accepte un email playwright-test-{ts}@mailinator.com valide', () => {
      expect(() => assertSafeEmail('playwright-test-1730000000000@mailinator.com')).not.toThrow();
    });

    it('accepte un email avec suffix alphanumérique', () => {
      expect(() => assertSafeEmail('playwright-test-1730000000000-happypath@mailinator.com')).not.toThrow();
    });

    it('accepte un email avec suffix multi-tirets', () => {
      expect(() => assertSafeEmail('playwright-test-1730000000000-happy-path-v2@mailinator.com')).not.toThrow();
    });

    it('refuse un email gmail random', () => {
      expect(() => assertSafeEmail('random@gmail.com')).toThrow(ProtectedEmailError);
    });

    it('refuse un email avec mauvais préfixe', () => {
      expect(() => assertSafeEmail('test-1730000000000@mailinator.com')).toThrow(ProtectedEmailError);
    });

    it('refuse un email avec mauvais domaine', () => {
      expect(() => assertSafeEmail('playwright-test-1730000000000@example.com')).toThrow(ProtectedEmailError);
    });

    it('refuse un email sans timestamp numérique', () => {
      expect(() => assertSafeEmail('playwright-test-abc@mailinator.com')).toThrow(ProtectedEmailError);
    });

    it('refuse une string vide', () => {
      expect(() => assertSafeEmail('')).toThrow(ProtectedEmailError);
    });

    it('refuse null', () => {
      expect(() => assertSafeEmail(null)).toThrow(ProtectedEmailError);
    });

    it('refuse undefined', () => {
      expect(() => assertSafeEmail(undefined)).toThrow(ProtectedEmailError);
    });
  });

  describe('deny-list backup', () => {
    it('refuse lubin.rom@gmail.com même si le pattern matchait', () => {
      expect(() => assertSafeEmail('lubin.rom@gmail.com')).toThrow(ProtectedEmailError);
    });

    it('refuse lubin.rom.ad@gmail.com', () => {
      expect(() => assertSafeEmail('lubin.rom.ad@gmail.com')).toThrow(ProtectedEmailError);
    });

    it('refuse amandine.lubin7218@gmail.com', () => {
      expect(() => assertSafeEmail('amandine.lubin7218@gmail.com')).toThrow(ProtectedEmailError);
    });

    it('refuse hemery.chlo@gmail.com', () => {
      expect(() => assertSafeEmail('hemery.chlo@gmail.com')).toThrow(ProtectedEmailError);
    });

    it('refuse les emails protégés en majuscules (insensible à la casse)', () => {
      expect(() => assertSafeEmail('LUBIN.ROM@GMAIL.COM')).toThrow(ProtectedEmailError);
    });

    it('refuse les emails protégés avec espaces autour', () => {
      expect(() => assertSafeEmail('  lubin.rom@gmail.com  ')).toThrow(ProtectedEmailError);
    });
  });

  describe('error content', () => {
    it('le message d\'erreur contient l\'email refusé', () => {
      try {
        assertSafeEmail('attacker@evil.com');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ProtectedEmailError);
        expect((err as Error).message).toContain('attacker@evil.com');
      }
    });

    it('contient le banner ultra-visible 🛑', () => {
      try {
        assertSafeEmail('random@gmail.com');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('🛑 PROTECTED EMAIL HIT 🛑');
      }
    });
  });
});

describe('generateTestEmail', () => {
  it('génère un email matchant le pattern allow-list', () => {
    const email = generateTestEmail();
    expect(__TEST_ONLY__.ALLOW_PATTERN.test(email)).toBe(true);
    expect(() => assertSafeEmail(email)).not.toThrow();
  });

  it('génère un email avec suffix matchant le pattern', () => {
    const email = generateTestEmail('happypath');
    expect(__TEST_ONLY__.ALLOW_PATTERN.test(email)).toBe(true);
    expect(email).toContain('-happypath@');
  });

  it('sanitize les caractères spéciaux du suffix', () => {
    const email = generateTestEmail('foo bar! @baz');
    expect(__TEST_ONLY__.ALLOW_PATTERN.test(email)).toBe(true);
    expect(email).not.toContain(' ');
    expect(email).not.toContain('!');
  });

  it('génère des emails uniques sur appels successifs', async () => {
    const e1 = generateTestEmail();
    await new Promise((r) => setTimeout(r, 5));
    const e2 = generateTestEmail();
    expect(e1).not.toBe(e2);
  });
});

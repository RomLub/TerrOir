import { describe, it, expect } from "vitest";
import { roundCoord } from "@/lib/producers/coords";

describe("roundCoord", () => {
  it("arrondit une latitude positive à 2 décimales", () => {
    expect(roundCoord(47.98765)).toBe(47.99);
  });

  it("arrondit une latitude négative à 2 décimales", () => {
    expect(roundCoord(-12.34567)).toBe(-12.35);
  });

  it("arrondit une longitude positive à 2 décimales", () => {
    expect(roundCoord(0.12345)).toBe(0.12);
  });

  it("arrondit une longitude négative à 2 décimales", () => {
    expect(roundCoord(-3.6789)).toBe(-3.68);
  });

  it("retourne null pour null", () => {
    expect(roundCoord(null)).toBeNull();
  });

  it("retourne null pour NaN", () => {
    expect(roundCoord(Number.NaN)).toBeNull();
  });

  it("retourne null pour Infinity", () => {
    expect(roundCoord(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("retourne null pour -Infinity", () => {
    expect(roundCoord(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("est idempotent sur une valeur déjà à 2 décimales", () => {
    expect(roundCoord(47.99)).toBe(47.99);
    expect(roundCoord(-3.68)).toBe(-3.68);
    expect(roundCoord(0)).toBe(0);
  });

  it("préserve un nombre entier (zéro décimale)", () => {
    expect(roundCoord(48)).toBe(48);
    expect(roundCoord(-1)).toBe(-1);
  });
});

describe("roundCoord — garantie de déterminisme (anti-trilatération)", () => {
  // Modèle de menace : un attaquant qui frappe N fois la même route publique
  // ne doit JAMAIS pouvoir reconstruire la coordonnée exacte en moyennant les
  // sorties. C'est garanti par l'absence d'offset aléatoire — on le verrouille
  // ici par un test de stabilité stricte sur un grand nombre d'appels.
  // Cf. lib/producers/coords.ts § "Garantie de déterminisme".

  it("retourne strictement la même valeur sur 10 000 appels consécutifs", () => {
    const inputs = [47.98765, -3.6789, 0.12345, -12.34567, 48.0061, 0];
    for (const input of inputs) {
      const reference = roundCoord(input);
      for (let i = 0; i < 10_000; i++) {
        expect(roundCoord(input)).toBe(reference);
      }
    }
  });

  it("est idempotent : roundCoord(roundCoord(x)) === roundCoord(x) pour tout x", () => {
    const samples = [
      47.123456, 47.999999, -3.6789, 0.12345, 48.0061, 0.0001, -0.0001, 90, -90,
    ];
    for (const x of samples) {
      const once = roundCoord(x);
      const twice = roundCoord(once);
      expect(twice).toBe(once);
    }
  });

  it("ne dépend pas de l'ordre d'appel (pas d'état caché)", () => {
    // Si une implémentation future introduisait par mégarde un offset
    // mémorisé, alterner les inputs trahirait la dérive. On vérifie l'absence
    // d'état partagé entre appels.
    const a = 47.123456;
    const b = -3.6789;
    const refA = roundCoord(a);
    const refB = roundCoord(b);
    for (let i = 0; i < 1_000; i++) {
      expect(roundCoord(a)).toBe(refA);
      expect(roundCoord(b)).toBe(refB);
    }
  });

  it("garantit une précision au plus de 0.01 (~1 km en lat, ~750 m en long à 47°N)", () => {
    // Verrou explicite sur la promesse "~1 km" affichée dans la doc et le
    // commentaire RGPD du widget. Si quelqu'un repasse à 3 décimales sans
    // le savoir, ce test casse — et le rapport sécu d'origine devra être
    // re-trancher (cf. T-217, T-231).
    const samples = [47.123456, -3.6789, 0.5, 48.0061];
    for (const x of samples) {
      const rounded = roundCoord(x);
      expect(rounded).not.toBeNull();
      // On vérifie que la valeur arrondie a au plus 2 décimales en
      // multipliant par 100 et en attendant un entier.
      expect(Math.round(rounded! * 100)).toBe(rounded! * 100);
      // Et que l'écart à l'original ne dépasse jamais 0.005 (demi-pas).
      expect(Math.abs(rounded! - x)).toBeLessThanOrEqual(0.005);
    }
  });
});

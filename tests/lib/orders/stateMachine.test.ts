import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  InvalidOrderTransitionError,
  type OrderStatus,
} from "@/lib/orders/stateMachine";

const STATUSES: readonly OrderStatus[] = [
  "pending",
  "confirmed",
  "ready",
  "completed",
  "cancelled",
  "refunded",
] as const;

// Source de vérité dupliquée volontairement (sinon on testerait
// l'implémentation par elle-même). Toute modif de TRANSITIONS dans
// stateMachine.ts doit aussi être répercutée ici, ce qui force une
// revue consciente de la matrice.
const LEGAL: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled", "refunded"],
  confirmed: ["ready", "cancelled", "refunded"],
  ready: ["completed", "cancelled", "refunded"],
  completed: [],
  cancelled: [],
  refunded: [],
};

describe("canTransition — matrice exhaustive 36 cellules", () => {
  for (const from of STATUSES) {
    describe(`from=${from}`, () => {
      for (const to of STATUSES) {
        const expected = LEGAL[from].includes(to);
        it(`${from} → ${to} → ${expected}`, () => {
          expect(canTransition(from, to)).toBe(expected);
        });
      }
    });
  }

  describe("cas dégénérés", () => {
    it("self-transition pending → pending → false (diagonale)", () => {
      expect(canTransition("pending", "pending")).toBe(false);
    });

    it("statut source invalide → false (couvre le ?? false ligne 27)", () => {
      expect(canTransition("foo" as OrderStatus, "confirmed")).toBe(false);
    });

    it("statut cible invalide → false", () => {
      expect(canTransition("pending", "bar" as OrderStatus)).toBe(false);
    });
  });
});

describe("assertTransition — contrat throw / no-throw", () => {
  describe("transitions légales : ne throw jamais", () => {
    for (const from of STATUSES) {
      for (const to of LEGAL[from]) {
        it(`${from} → ${to} ne throw pas`, () => {
          expect(() => assertTransition(from, to)).not.toThrow();
        });
      }
    }
  });

  describe("transitions illégales : throw InvalidOrderTransitionError", () => {
    // Échantillon représentatif (pas re-dérouler les 28 cellules de
    // canTransition — on teste le contrat throw, pas la matrice).
    const ILLEGAL_SAMPLES: ReadonlyArray<[OrderStatus, OrderStatus]> = [
      // Diagonale (X → X)
      ["pending", "pending"],
      ["confirmed", "confirmed"],
      ["ready", "ready"],
      // Sauts en avant impossibles
      ["pending", "ready"],
      ["pending", "completed"],
      ["confirmed", "completed"],
      // Retours en arrière interdits
      ["confirmed", "pending"],
      ["ready", "confirmed"],
      // Terminaux : aucune transition sortante
      ["completed", "ready"],
      ["completed", "refunded"],
      ["cancelled", "pending"],
      ["cancelled", "refunded"],
      ["refunded", "completed"],
      ["refunded", "cancelled"],
    ];

    for (const [from, to] of ILLEGAL_SAMPLES) {
      it(`${from} → ${to} throw InvalidOrderTransitionError`, () => {
        expect(() => assertTransition(from, to)).toThrow(
          InvalidOrderTransitionError,
        );
      });

      it(`${from} → ${to} message contient les deux statuts`, () => {
        const re = new RegExp(`${from}.*${to}`);
        expect(() => assertTransition(from, to)).toThrow(re);
      });
    }
  });
});

describe("isTerminal — sémantique", () => {
  describe("statuts terminaux (longueur transitions = 0)", () => {
    it("completed → true", () => {
      expect(isTerminal("completed")).toBe(true);
    });
    it("cancelled → true", () => {
      expect(isTerminal("cancelled")).toBe(true);
    });
    it("refunded → true", () => {
      expect(isTerminal("refunded")).toBe(true);
    });
  });

  describe("statuts non terminaux", () => {
    it("pending → false", () => {
      expect(isTerminal("pending")).toBe(false);
    });
    it("confirmed → false", () => {
      expect(isTerminal("confirmed")).toBe(false);
    });
    it("ready → false", () => {
      expect(isTerminal("ready")).toBe(false);
    });
  });

  describe("contrat fail-fast (asymétrie volontaire vs canTransition)", () => {
    // Le call site unique (cancel route) lit order.statut depuis une
    // colonne sous CHECK constraint SQL miroir de OrderStatus. Un statut
    // hors enum = invariant DB↔TS violé. Crasher est la sémantique voulue
    // (cf JSDoc isTerminal). Ce test fige le contrat — toute "harmonisation"
    // future avec canTransition devra explicitement le casser.
    it("statut hors enum → throw (pas de guard défensif silencieux)", () => {
      expect(() => isTerminal("invalid_status" as OrderStatus)).toThrow();
    });
  });
});

describe("InvalidOrderTransitionError — contrat erreur", () => {
  it("est une instance de Error", () => {
    const err = new InvalidOrderTransitionError("pending", "completed");
    expect(err).toBeInstanceOf(Error);
  });

  it("est une instance de InvalidOrderTransitionError", () => {
    const err = new InvalidOrderTransitionError("pending", "completed");
    expect(err).toBeInstanceOf(InvalidOrderTransitionError);
  });

  it("expose name = 'InvalidOrderTransitionError'", () => {
    const err = new InvalidOrderTransitionError("pending", "completed");
    expect(err.name).toBe("InvalidOrderTransitionError");
  });

  it("expose from et to en propriétés readonly", () => {
    const err = new InvalidOrderTransitionError("ready", "refunded");
    expect(err.from).toBe("ready");
    expect(err.to).toBe("refunded");
  });

  it("message contient les deux statuts (utile aux call sites pour debug)", () => {
    const err = new InvalidOrderTransitionError("confirmed", "pending");
    expect(err.message).toContain("confirmed");
    expect(err.message).toContain("pending");
  });

  it("instanceof reste fiable après throw + catch (call sites en dépendent)", () => {
    let caught: unknown = null;
    try {
      assertTransition("completed", "ready");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidOrderTransitionError);
    if (caught instanceof InvalidOrderTransitionError) {
      expect(caught.from).toBe("completed");
      expect(caught.to).toBe("ready");
    }
  });
});

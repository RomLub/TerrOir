import { describe, it, expect } from "vitest";
import {
  ACTIVE_ORDER_STATUTS,
  canTransition,
  assertTransition,
  isTerminal,
  canConsumerCancel,
  canProducerCancel,
  InvalidOrderTransitionError,
  type OrderStatus,
} from "@/lib/orders/stateMachine";

const STATUSES: readonly OrderStatus[] = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "refunded",
] as const;

// Source de vérité dupliquée volontairement (sinon on testerait
// l'implémentation par elle-même). Toute modif de TRANSITIONS dans
// stateMachine.ts doit aussi être répercutée ici, ce qui force une
// revue consciente de la matrice.
//
// Cluster C — T6 cleanup : 'ready' retiré du modèle (CHECK orders.statut +
// union TS), matrice passe de 6×6 à 5×5.
const LEGAL: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled", "refunded"],
  confirmed: ["completed", "cancelled", "refunded"],
  completed: [],
  cancelled: [],
  refunded: [],
};

describe("canTransition — matrice exhaustive 25 cellules", () => {
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

    it("statut source invalide → false (couvre le ?? false)", () => {
      expect(canTransition("foo" as OrderStatus, "confirmed")).toBe(false);
    });

    it("statut cible invalide → false", () => {
      expect(canTransition("pending", "bar" as OrderStatus)).toBe(false);
    });

    it("ancienne valeur 'ready' (legacy retirée Cluster C) → false depuis pending", () => {
      // Garde-fou : 'ready' n'est plus un statut légal mais un input dynamique
      // pourrait encore arriver via un payload externe. canTransition tolère
      // grâce au `?.` défensif et retourne false.
      expect(canTransition("pending", "ready" as unknown as OrderStatus)).toBe(false);
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
    const ILLEGAL_SAMPLES: ReadonlyArray<[OrderStatus, OrderStatus]> = [
      // Diagonale (X → X)
      ["pending", "pending"],
      ["confirmed", "confirmed"],
      // Sauts en avant impossibles
      ["pending", "completed"],
      // Retours en arrière interdits
      ["confirmed", "pending"],
      // Terminaux : aucune transition sortante
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
    const err = new InvalidOrderTransitionError("confirmed", "refunded");
    expect(err.from).toBe("confirmed");
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
      assertTransition("completed", "pending");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidOrderTransitionError);
    if (caught instanceof InvalidOrderTransitionError) {
      expect(caught.from).toBe("completed");
      expect(caught.to).toBe("pending");
    }
  });
});

describe("canConsumerCancel — T-420", () => {
  it("1 — pending → true", () => {
    expect(canConsumerCancel("pending")).toBe(true);
  });

  it("2 — confirmed → false", () => {
    expect(canConsumerCancel("confirmed")).toBe(false);
  });

  it("3 — completed → false", () => {
    expect(canConsumerCancel("completed")).toBe(false);
  });

  it("4 — cancelled → false", () => {
    expect(canConsumerCancel("cancelled")).toBe(false);
  });

  it("5 — refunded → false", () => {
    expect(canConsumerCancel("refunded")).toBe(false);
  });
});

describe("canProducerCancel — T-420", () => {
  it("1 — pending → true", () => {
    expect(canProducerCancel("pending")).toBe(true);
  });

  it("2 — confirmed → true", () => {
    expect(canProducerCancel("confirmed")).toBe(true);
  });

  it("3 — completed → false (terminal)", () => {
    expect(canProducerCancel("completed")).toBe(false);
  });

  it("4 — cancelled → false (terminal)", () => {
    expect(canProducerCancel("cancelled")).toBe(false);
  });

  it("5 — refunded → false (terminal)", () => {
    expect(canProducerCancel("refunded")).toBe(false);
  });
});

describe("ACTIVE_ORDER_STATUTS — Cluster C", () => {
  it("contient pending et confirmed (pas plus, pas moins)", () => {
    expect([...ACTIVE_ORDER_STATUTS].sort()).toEqual(["confirmed", "pending"]);
  });

  it("ne contient plus 'ready' (état mort retiré T6)", () => {
    expect((ACTIVE_ORDER_STATUTS as readonly string[]).includes("ready")).toBe(
      false,
    );
  });

  it("longueur figée à 2", () => {
    // Garde-fou applicatif. La readonly-ness vient du `as const` et est
    // contrainte côté TypeScript uniquement (à runtime l'array reste un
    // Array JS standard) — c'est l'intention contractuelle qu'on fige ici.
    expect(ACTIVE_ORDER_STATUTS.length).toBe(2);
  });
});

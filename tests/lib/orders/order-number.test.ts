import { describe, it, expect } from "vitest";
import {
  formatOrderNumber,
  formatProducerNumber,
} from "@/lib/orders/order-number";

describe("formatOrderNumber", () => {
  it("padding basique : producteur 42, commande 128", () => {
    expect(formatOrderNumber(42, 128)).toBe("0042-00128");
  });

  it("premier producteur, première commande", () => {
    expect(formatOrderNumber(1, 1)).toBe("0001-00001");
  });

  it("producteur déjà à 4 chiffres → pas de tronquage", () => {
    expect(formatOrderNumber(9999, 99999)).toBe("9999-99999");
  });

  it("dépassement 4 chiffres : valeur conservée (extensibilité)", () => {
    // padStart ne tronque pas, il garde la valeur entière.
    expect(formatOrderNumber(10000, 1)).toBe("10000-00001");
  });

  it("dépassement 5 chiffres seq", () => {
    expect(formatOrderNumber(1, 123456)).toBe("0001-123456");
  });
});

describe("formatProducerNumber", () => {
  it("pad à 4 chiffres", () => {
    expect(formatProducerNumber(1)).toBe("0001");
    expect(formatProducerNumber(42)).toBe("0042");
    expect(formatProducerNumber(9999)).toBe("9999");
  });

  it("ne tronque pas au-delà de 4 chiffres", () => {
    expect(formatProducerNumber(10000)).toBe("10000");
  });
});

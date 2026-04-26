import { describe, it, expect } from "vitest";
import { getProducerDisplayName } from "@/lib/producers/get-display-name";

describe("getProducerDisplayName", () => {
  it("retourne le prenom trimmé quand user.prenom est non vide", () => {
    expect(getProducerDisplayName({ prenom: "Julien" })).toBe("Julien");
  });

  it("trim les espaces autour du prenom", () => {
    expect(getProducerDisplayName({ prenom: "  Marie  " })).toBe("Marie");
  });

  it("préserve les prénoms composés tels quels (ex: 'Julien et Marie')", () => {
    expect(getProducerDisplayName({ prenom: "Julien et Marie" })).toBe(
      "Julien et Marie",
    );
  });

  it("retourne null quand user est null", () => {
    expect(getProducerDisplayName(null)).toBeNull();
  });

  it("retourne null quand user est undefined", () => {
    expect(getProducerDisplayName(undefined)).toBeNull();
  });

  it("retourne null quand user.prenom est null", () => {
    expect(getProducerDisplayName({ prenom: null })).toBeNull();
  });

  it("retourne null quand user.prenom est une chaîne vide", () => {
    expect(getProducerDisplayName({ prenom: "" })).toBeNull();
  });

  it("retourne null quand user.prenom ne contient que des espaces", () => {
    expect(getProducerDisplayName({ prenom: "   " })).toBeNull();
  });
});

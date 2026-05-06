import { describe, it, expect } from "vitest";
import { getProducerStatusLabel } from "@/components/ui/producer-status-badge";

describe("getProducerStatusLabel", () => {
  it.each([
    ["draft", "Brouillon"],
    ["pending", "En attente"],
    ["active", "Validé"],
    ["public", "Public"],
    ["suspended", "Suspendu"],
    ["deleted", "Supprimé"],
  ])("statut '%s' → libellé FR '%s'", (statut, label) => {
    expect(getProducerStatusLabel(statut)).toBe(label);
  });

  it("statut inconnu → fallback sur la valeur brute", () => {
    expect(getProducerStatusLabel("totalement_inconnu")).toBe(
      "totalement_inconnu",
    );
  });
});

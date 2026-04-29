import { describe, it, expect } from "vitest";
import { mapStatusToBadge } from "@/app/(producer)/revenus/_lib/badge-mapping";

describe("mapStatusToBadge — T-414 4-states UI revenus", () => {
  it("pending → gray 'En file d'attente'", () => {
    expect(mapStatusToBadge("pending")).toEqual({
      variant: "gray",
      label: "En file d'attente",
    });
  });

  it("processing → blue 'Virement en cours'", () => {
    expect(mapStatusToBadge("processing")).toEqual({
      variant: "blue",
      label: "Virement en cours",
    });
  });

  it("paid → green 'Viré'", () => {
    expect(mapStatusToBadge("paid")).toEqual({
      variant: "green",
      label: "Viré",
    });
  });

  it("failed → danger 'Échec, contactez-nous'", () => {
    expect(mapStatusToBadge("failed")).toEqual({
      variant: "danger",
      label: "Échec, contactez-nous",
    });
  });

  it("statut inconnu → fallback pending (defensive)", () => {
    expect(mapStatusToBadge("weird_status")).toEqual({
      variant: "gray",
      label: "En file d'attente",
    });
  });
});

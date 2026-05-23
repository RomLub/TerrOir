import { describe, it, expect } from "vitest";
import {
  PRODUCER_STATUS_FILTERS,
  parseProducerStatusFilter,
} from "@/lib/admin/producers/types";

// Chantier 4 — parse fail-safe du query param `?status=` (deep-link cockpit
// dashboard / journal d'audit). Mirroir du pattern parseDashboardPeriod.
describe("parseProducerStatusFilter", () => {
  it("accepte les 6 valeurs de filtre valides", () => {
    for (const f of PRODUCER_STATUS_FILTERS) {
      expect(parseProducerStatusFilter(f)).toBe(f);
    }
  });

  it("fail-safe → 'all' sur valeur absente / invalide / array", () => {
    expect(parseProducerStatusFilter(undefined)).toBe("all");
    expect(parseProducerStatusFilter("")).toBe("all");
    expect(parseProducerStatusFilter("garbage")).toBe("all");
    expect(parseProducerStatusFilter(["pending", "active"])).toBe("pending"); // 1er élément valide
    expect(parseProducerStatusFilter(["bad"])).toBe("all");
  });
});

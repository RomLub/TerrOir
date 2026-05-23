import { describe, it, expect } from "vitest";
import {
  DASHBOARD_PERIODS,
  PERIOD_LABELS,
  parseDashboardPeriod,
} from "@/lib/admin/dashboard/period";

describe("parseDashboardPeriod", () => {
  it("accepte les 4 périodes valides", () => {
    for (const p of DASHBOARD_PERIODS) {
      expect(parseDashboardPeriod(p)).toBe(p);
    }
  });

  it("fail-safe → 'today' sur valeur absente / invalide / array", () => {
    expect(parseDashboardPeriod(undefined)).toBe("today");
    expect(parseDashboardPeriod("")).toBe("today");
    expect(parseDashboardPeriod("garbage")).toBe("today");
    expect(parseDashboardPeriod(["week", "month"])).toBe("week"); // 1er élément valide
    expect(parseDashboardPeriod(["bad"])).toBe("today");
  });

  it("chaque période a un libellé FR", () => {
    for (const p of DASHBOARD_PERIODS) {
      expect(PERIOD_LABELS[p]).toBeTruthy();
    }
  });
});

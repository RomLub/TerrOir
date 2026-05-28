import { describe, expect, it } from "vitest";
import { resolveAccountingExportPeriod } from "@/lib/accounting/export-periods";

const NOW = new Date("2026-05-28T10:00:00.000Z");

function expectPeriod(
  period: string,
  expected: { from: string; to: string },
) {
  const result = resolveAccountingExportPeriod({ period, now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.period.from).toBe(expected.from);
  expect(result.period.to).toBe(expected.to);
}

describe("resolveAccountingExportPeriod", () => {
  it("calcule les périodes mois, trimestre et année", () => {
    expectPeriod("current-month", { from: "2026-05-01", to: "2026-05-28" });
    expectPeriod("previous-month", { from: "2026-04-01", to: "2026-04-30" });
    expectPeriod("current-quarter", {
      from: "2026-04-01",
      to: "2026-05-28",
    });
    expectPeriod("previous-quarter", {
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expectPeriod("current-year", { from: "2026-01-01", to: "2026-05-28" });
    expectPeriod("previous-year", { from: "2025-01-01", to: "2025-12-31" });
  });

  it("accepte une période personnalisée", () => {
    const result = resolveAccountingExportPeriod({
      period: "custom",
      from: "2026-02-10",
      to: "2026-02-20",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.period.key).toBe("custom");
    expect(result.period.from).toBe("2026-02-10");
    expect(result.period.to).toBe("2026-02-20");
  });

  it("refuse une période personnalisée incomplète", () => {
    const result = resolveAccountingExportPeriod({
      period: "custom",
      from: "2026-02-10",
      now: NOW,
    });

    expect(result.ok).toBe(false);
  });
});

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountingExportContent } from "@/app/(producer)/comptabilite/_components/AccountingExportContent";
import type { ProducerAccountingExportData } from "@/lib/accounting/types";

describe("AccountingExportContent", () => {
  it("affiche un état vide propre quand aucune commande n'est incluse", () => {
    render(
      <AccountingExportContent
        data={{
          period: {
            key: "custom",
            label: "Période personnalisée · 1 mai 2026 au 31 mai 2026",
            from: "2026-05-01",
            to: "2026-05-31",
            parsed: {
              fromIso: "2026-04-30T22:00:00.000Z",
              toEndOfDayIso: "2026-05-31T21:59:59.999Z",
            },
          },
          rows: [],
          summary: {
            orderCount: 0,
            grossRevenue: 0,
            terroirCommission: 0,
            producerNet: 0,
            cancelledOrRefundedCount: 0,
          },
        } satisfies ProducerAccountingExportData}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Aucune commande sur cette période",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Télécharger le CSV" }),
    ).toHaveProperty("disabled", true);
  });
});

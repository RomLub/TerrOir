"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ACCOUNTING_PERIOD_OPTIONS } from "@/lib/accounting/export-periods";
import type { AccountingExportPeriodKey } from "@/lib/accounting/types";

type AccountingPeriodControlsProps = {
  periodKey: AccountingExportPeriodKey;
  from: string;
  to: string;
};

export function AccountingPeriodControls({
  periodKey,
  from,
  to,
}: AccountingPeriodControlsProps) {
  const [selectedPeriod, setSelectedPeriod] = useState(periodKey);
  const isCustom = selectedPeriod === "custom";

  return (
    <form method="get" className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]">
      <Select
        id="accounting-period"
        name="period"
        label="Période"
        value={selectedPeriod}
        onChange={(event) =>
          setSelectedPeriod(event.currentTarget.value as AccountingExportPeriodKey)
        }
        options={ACCOUNTING_PERIOD_OPTIONS}
      />
      <Input
        id="accounting-from"
        name="from"
        label="Du"
        type="date"
        defaultValue={from}
        disabled={!isCustom}
      />
      <Input
        id="accounting-to"
        name="to"
        label="Au"
        type="date"
        defaultValue={to}
        disabled={!isCustom}
      />
      <div className="flex items-end">
        <Button type="submit" variant="secondary" className="w-full">
          Afficher la synthèse
        </Button>
      </div>
    </form>
  );
}

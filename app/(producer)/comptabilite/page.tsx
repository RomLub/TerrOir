import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getDefaultAccountingExportPeriod,
  resolveAccountingExportPeriod,
} from "@/lib/accounting/export-periods";
import { getProducerAccountingExportData } from "@/lib/accounting/producer-export-data";
import { AccountingExportContent } from "./_components/AccountingExportContent";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Record<string, string | string[] | undefined>;

function getSingleParam(
  searchParams: SearchParams,
  key: string,
): string | null {
  const value = searchParams[key];
  return typeof value === "string" ? value : null;
}

export default async function ComptabilitePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const params = await searchParams;
  const periodResult = resolveAccountingExportPeriod({
    period: getSingleParam(params, "period"),
    from: getSingleParam(params, "from"),
    to: getSingleParam(params, "to"),
  });
  const period = periodResult.ok
    ? periodResult.period
    : getDefaultAccountingExportPeriod();

  const data = await getProducerAccountingExportData({
    supabase: createSupabaseAdminClient(),
    userId: session.id,
    period,
  });

  if (!data) redirect("/invitation");

  return (
    <AccountingExportContent
      data={data}
      periodError={periodResult.ok ? null : periodResult.error}
    />
  );
}

import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { AnnualReportDocument } from "@/lib/accounting/pdf/templates/annual-report";
import type { ProducerAnnualReportData } from "@/lib/accounting/producer-annual-report";
import { loadAccountingLogoDataUri } from "@/lib/accounting/producer-pdf-assets";

export async function generateProducerAnnualReportPdf(
  data: ProducerAnnualReportData,
): Promise<Buffer> {
  const logoSrc = await loadAccountingLogoDataUri();
  const document = createElement(AnnualReportDocument, {
    data,
    logoSrc,
  }) as Parameters<typeof renderToBuffer>[0];
  return renderToBuffer(document);
}

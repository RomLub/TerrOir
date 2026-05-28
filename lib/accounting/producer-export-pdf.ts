import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { AccountingSummaryDocument } from "@/lib/accounting/pdf/templates/accounting-summary";
import type { ProducerAccountingExportData } from "@/lib/accounting/producer-export-data";

let logoDataUriPromise: Promise<string> | null = null;

export async function generateProducerAccountingPdf(
  data: ProducerAccountingExportData,
): Promise<Buffer> {
  const logoSrc = await loadLogoDataUri();
  const document = createElement(AccountingSummaryDocument, {
    data,
    logoSrc,
  }) as Parameters<typeof renderToBuffer>[0];
  return renderToBuffer(document);
}

async function loadLogoDataUri(): Promise<string> {
  logoDataUriPromise ??= readFile(
    join(process.cwd(), "public", "email-assets", "logo-email.png"),
  ).then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`);
  return logoDataUriPromise;
}

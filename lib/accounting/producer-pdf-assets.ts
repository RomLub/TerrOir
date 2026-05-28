import { readFile } from "node:fs/promises";
import { join } from "node:path";

let logoDataUriPromise: Promise<string> | null = null;

export async function loadAccountingLogoDataUri(): Promise<string> {
  logoDataUriPromise ??= readFile(
    join(process.cwd(), "public", "email-assets", "logo-email.png"),
  ).then((buffer) => `data:image/png;base64,${buffer.toString("base64")}`);
  return logoDataUriPromise;
}

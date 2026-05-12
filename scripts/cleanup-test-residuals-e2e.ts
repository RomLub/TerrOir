/**
 * scripts/cleanup-test-residuals-e2e.ts
 * Sweep CLI standalone des résiduels E2E (sentinel playwright-test-*@mailinator.com).
 *
 * Wrapper sur sweepE2EResiduals (tests/e2e/helpers/db-cleanup.ts), exposé en CLI
 * pour invocation hors Playwright lifecycle (cron Vercel hebdo, sweep manuel
 * post-incident, debug local sans run Playwright complet).
 *
 * Usage :
 *   npx tsx scripts/cleanup-test-residuals-e2e.ts                    # apply
 *   npx tsx scripts/cleanup-test-residuals-e2e.ts --dry-run          # preview only
 *   npx tsx scripts/cleanup-test-residuals-e2e.ts --min-age-hours=24 # custom age filter
 *
 * Cf. doctrine docs/conventions/regression-tests-security.md (E2E sentinel + cleanup).
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Charge .env.local AVANT import sweepE2EResiduals (qui résout getRawAdminClient
// au runtime, lequel exige NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
loadEnv({ path: resolve(process.cwd(), ".env.local") });

import { sweepE2EResiduals } from "@/tests/e2e/helpers/db-cleanup";

function parseArgs(argv: string[]): { dryRun: boolean; minAgeHours?: number } {
  const dryRun = argv.includes("--dry-run");
  const ageArg = argv.find((a) => a.startsWith("--min-age-hours="));
  const minAgeHours = ageArg ? Number(ageArg.split("=")[1]) : undefined;
  if (ageArg && (!Number.isFinite(minAgeHours) || minAgeHours! < 0)) {
    console.error(`✗ Invalid --min-age-hours value: ${ageArg.split("=")[1]}`);
    process.exit(2);
  }
  return { dryRun, minAgeHours };
}

async function main(): Promise<void> {
  const { dryRun, minAgeHours } = parseArgs(process.argv.slice(2));
  console.log("=".repeat(70));
  console.log("Cleanup E2E residuals (sentinel playwright-test-*@mailinator.com)");
  console.log(`  mode   : ${dryRun ? "DRY-RUN" : "APPLY"}`);
  console.log(`  minAge : ${minAgeHours ?? "default (6h)"}`);
  console.log("=".repeat(70));

  const result = await sweepE2EResiduals({ dryRun, minAgeHours });

  console.log(`\nResult :`);
  console.log(`  authUsersDeleted  : ${result.authUsersDeleted}`);
  console.log(`  testEmailsDeleted : ${result.testEmailsDeleted}`);
  console.log(`  errors            : ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.error(`\n✗ ${result.errors.length} error(s) :`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  if (dryRun) console.log("\n  (dry-run, rien n'a été supprimé)");
  console.log("\n✓ OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✗ Erreur :", err);
  process.exit(1);
});

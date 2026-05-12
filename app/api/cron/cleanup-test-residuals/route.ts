import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { sweepE2EResiduals } from "@/lib/maintenance/sweep-e2e-residuals";

// POST /api/cron/cleanup-test-residuals (cron weekly dimanche 2h UTC,
// cf. vercel.json).
//
// Sweep défensif weekly des résiduels E2E (sentinel
// `playwright-test-*@mailinator.com`). Filet ultime contre les crashs mid-flight
// Playwright qui auraient sauté `global-teardown` (ex: Next 16 dev crash
// documenté CLAUDE.md L280, OS-kill, ECONNREFUSED).
//
// Pattern aligné app/api/cron/purge-otp-codes/route.ts :
//   - Auth Bearer CRON_SECRET (lib/cron/auth.ts).
//   - POST + export GET = POST (Vercel cron déclenche en GET par défaut).
//   - Logging structured `[CRON_CLEANUP_E2E_RESIDUALS]`.
//
// Logique métier déléguée à lib/maintenance/sweep-e2e-residuals.ts (module
// canonique partagé avec Playwright global-setup/teardown + script CLI
// scripts/cleanup-test-residuals-e2e.ts).
//
// minAgeHours=168 (= 7 jours) : conservateur vs default 6h. Le cron est weekly,
// donc tout résiduel >7j est forcément orphelin (un run Playwright en cours
// ne dure jamais 7j).
//
// Cf. doctrine docs/conventions/regression-tests-security.md (E2E sentinel
// + cleanup, section 4 bis et section 7 cross-doctrines).

export const maxDuration = 60;

const DEFAULT_MIN_AGE_HOURS = 168; // 7 jours

export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const result = await sweepE2EResiduals({
    minAgeHours: DEFAULT_MIN_AGE_HOURS,
  });

  console.log(
    `[CRON_CLEANUP_E2E_RESIDUALS] auth_users_deleted=${result.authUsersDeleted} ` +
      `test_emails_deleted=${result.testEmailsDeleted} errors=${result.errors.length}`,
  );

  return NextResponse.json(
    {
      auth_users_deleted: result.authUsersDeleted,
      test_emails_deleted: result.testEmailsDeleted,
      errors: result.errors,
    },
    { status: result.errors.length > 0 ? 500 : 200 },
  );
}

// Vercel cron déclenche les routes via GET par défaut.
export const GET = POST;

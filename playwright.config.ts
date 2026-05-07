import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Charge .env.local pour récupérer EMAIL_CHANGE_OTP_SECRET et les
// credentials Supabase service_role nécessaires aux helpers.
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

/**
 * Playwright config TerrOir — Phase 1
 *
 * Contraintes :
 * - Tests tournent en LOCAL contre la prod Supabase (pas d'env dev séparé).
 * - Chromium uniquement pour limiter le temps de run.
 * - Volumétrie max ~10-20 tests pour respecter quota Resend (3000 mails/mois).
 * - Pas de retry agressif : on veut détecter la flakiness, pas la masquer.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Restreint à .spec.ts : empêche Playwright de charger les .test.ts Vitest
  // sous tests/e2e/helpers/__tests__/ (default match = *.@(spec|test).?(c|m)[jt]s?(x)).
  testMatch: '**/*.spec.ts',
  // Setup files ne sont pas des tests (ils n'utilisent pas test()/expect()),
  // mais on les exclut explicitement pour clarté + safety.
  testIgnore: ['**/setup/**'],
  fullyParallel: false, // Séquentiel : on tape sur prod DB, on évite les races
  forbidOnly: !!process.env.CI,
  retries: 0, // 0 en local pour voir les vrais flakes
  workers: 1, // Un seul worker pour éviter conflits de cleanup en DB partagée
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  // Setup/teardown globaux : sweep résiduels e2e + cleanup persistent users
  // (cf. tests/e2e/setup/global-{setup,teardown}.ts).
  globalSetup: './tests/e2e/setup/global-setup.ts',
  globalTeardown: './tests/e2e/setup/global-teardown.ts',

  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // Next.js dev server cold start peut être long
    stdout: 'ignore',
    stderr: 'pipe',
    // RESEND_TEST_MODE=true active la capture e2e dans test_emails_captured
    // (cf. lib/resend/send.ts isE2ETestCaptureMode). Gate strict NODE_ENV !==
    // production côté send.ts → safe en local dev (NODE_ENV=development par
    // défaut sous `next dev`).
    env: {
      RESEND_TEST_MODE: 'true',
    },
  },
});

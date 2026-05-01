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
  fullyParallel: false, // Séquentiel : on tape sur prod DB, on évite les races
  forbidOnly: !!process.env.CI,
  retries: 0, // 0 en local pour voir les vrais flakes
  workers: 1, // Un seul worker pour éviter conflits de cleanup en DB partagée
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

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
  },
});

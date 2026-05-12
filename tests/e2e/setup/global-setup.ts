/**
 * Playwright global-setup — exécuté UNE FOIS avant tous les tests.
 *
 * Phase 1 scope (minimal) :
 *   1. Valide les env vars critiques (.env.local doit être chargé par
 *      playwright.config.ts dotenv).
 *   2. Sweep résiduels e2e older than 6h (purge défensive avant run).
 *   3. Log un beacon visible avec le runId pour faciliter le grep
 *      audit-log.jsonl post-run.
 *
 * Phase 2+ extension prévue : génération lazy des storageState pré-
 * calculés (consumer/producer/admin) si les tests des Phases 2+ en ont
 * besoin. Helper auth-state.ts est prêt — il suffira d'appeler
 * ensurePersistentUser + captureAuthState pour chaque rôle.
 *
 * NOTE : Playwright lance globalSetup AVANT le webServer.command si la
 * config a `webServer.reuseExistingServer=false`. On ne fait donc PAS
 * d'appels HTTP au app Next.js ici (DB only).
 */

import dotenv from 'dotenv';
import path from 'path';
import { sweepE2EResiduals } from '@/lib/maintenance/sweep-e2e-residuals';
import { createRunId } from '../helpers/audit-log';

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

// RESEND_TEST_MODE est posé au niveau webServer (cf. playwright.config.ts
// webServer.env), pas au niveau process Playwright. On ne peut pas le
// vérifier ici depuis ce process — la sanity-check se fait via le pilote
// stock-alert-capture (waitForCapturedEmail throw timeout si flag absent).

export default async function globalSetup(): Promise<void> {
  // S'assure que .env.local est chargé même si playwright.config.ts l'a
  // raté pour une raison ou une autre (override ESM/CJS, run depuis IDE...).
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[playwright global-setup] env vars manquantes : ${missing.join(', ')}. ` +
      `Vérifier .env.local à la racine du projet.`,
    );
  }

  if (
    process.env.RESEND_TEST_MODE === 'true' &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      `[playwright global-setup] RESEND_TEST_MODE=true + NODE_ENV=production refusé. ` +
      `Le flag est gated NODE_ENV !== production côté send.ts mais on bloque aussi en amont par sécurité.`,
    );
  }

  const runId = createRunId();
  console.log(`\n[playwright global-setup] runId=${runId}`);

  console.log('[playwright global-setup] sweep résiduels >6h en cours...');
  const sweep = await sweepE2EResiduals({ minAgeHours: 6, dryRun: false });
  console.log(
    `[playwright global-setup] sweep done : authUsersDeleted=${sweep.authUsersDeleted} ` +
    `testEmailsDeleted=${sweep.testEmailsDeleted} errors=${sweep.errors.length}`,
  );
  if (sweep.errors.length > 0) {
    for (const err of sweep.errors) {
      console.warn(`  [sweep] ${err}`);
    }
  }
}

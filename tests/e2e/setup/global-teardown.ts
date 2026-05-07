/**
 * Playwright global-teardown — exécuté UNE FOIS après tous les tests.
 *
 * Scope Phase 1+ :
 *   1. Cleanup persistent users (3 personas) si générés par global-setup
 *      Phase 2+. Idempotent : ne plante pas si aucun n'existe.
 *   2. Sweep défensif final : purge tout résiduel playwright-test-* +
 *      test_emails_captured matchant le préfixe (peu importe l'âge,
 *      car un afterEach a pu rater).
 *
 * Décision : on prend `minAgeHours: 0` ici (vs 6h en global-setup) car
 * en fin de run, on est sûr qu'aucun autre run n'est en cours sur cette
 * machine. Cleanup agressif acceptable.
 *
 * En cas d'erreur on LOG mais on ne THROW PAS — un cleanup raté ne doit
 * pas faire échouer la session entière (mieux vaut une erreur visible
 * dans les logs qu'un exit code de session masquant les vrais résultats).
 */

import { sweepE2EResiduals } from '../helpers/db-cleanup';
import { cleanupPersistentUsers } from '../helpers/auth-state';

export default async function globalTeardown(): Promise<void> {
  console.log('\n[playwright global-teardown] cleanup persistent users...');
  try {
    const persistent = await cleanupPersistentUsers();
    console.log(
      `[playwright global-teardown] persistent cleanup : deleted=${persistent.deleted.join(',') || 'none'} errors=${persistent.errors.length}`,
    );
    for (const err of persistent.errors) {
      console.warn(`  [persistent] ${err}`);
    }
  } catch (err) {
    console.error(
      `[playwright global-teardown] cleanupPersistentUsers exception: ${(err as Error).message}`,
    );
  }

  console.log('[playwright global-teardown] sweep résiduels (full)...');
  try {
    const sweep = await sweepE2EResiduals({ minAgeHours: 0, dryRun: false });
    console.log(
      `[playwright global-teardown] sweep done : authUsersDeleted=${sweep.authUsersDeleted} ` +
      `testEmailsDeleted=${sweep.testEmailsDeleted} errors=${sweep.errors.length}`,
    );
    for (const err of sweep.errors) {
      console.warn(`  [sweep] ${err}`);
    }
  } catch (err) {
    console.error(
      `[playwright global-teardown] sweepE2EResiduals exception: ${(err as Error).message}`,
    );
  }
}

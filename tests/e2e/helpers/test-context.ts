/**
 * Fixture Playwright qui injecte un TestContext frais à chaque test
 * et fait le cleanup automatique en afterEach.
 *
 * Usage dans un .spec.ts :
 *   import { test } from '../helpers/test-context';
 *
 *   test('mon test', async ({ page, ctx }) => {
 *     const user = await createTestUser(ctx);
 *     // ...
 *   });
 *
 * Le runId est partagé entre tous les tests d'une même session Playwright
 * (worker scope), les autres champs sont scopés au test individuel.
 */

import { test as base } from '@playwright/test';
import { createRunId } from './audit-log';
import { TestContext } from './supabase-admin';
import { cleanupAllTrackedUsers } from './user-lifecycle';

interface CtxFixtures {
  /** TestContext frais par test (trackedUserIds/trackedRowIds/Emails reset à chaque fois). */
  ctx: TestContext;
}

interface WorkerFixtures {
  /** runId stable pour toute la session (1 worker = 1 runId). */
  runId: string;
}

export const test = base.extend<CtxFixtures, WorkerFixtures>({
  // Worker-scoped : créé une fois, réutilisé pour tous les tests du worker
  runId: [
    async ({}, use) => {
      const id = createRunId();
      console.log(`\n[playwright] runId = ${id}\n`);
      await use(id);
    },
    { scope: 'worker' },
  ],

  // Test-scoped : créé par test, cleanup auto en afterEach
  ctx: async ({ runId }, use, testInfo) => {
    const ctx: TestContext = {
      runId,
      testId: testInfo.titlePath.join(' > '),
      trackedUserIds: new Set<string>(),
      trackedRowIds: new Set<string>(),
      trackedEmails: new Set<string>(),
    };

    await use(ctx);

    // Cleanup automatique post-test : on ne nettoie QUE les users.
    // trackedRowIds n'a pas de cleanup dédié car la FK user_id ON DELETE CASCADE
    // purge automatiquement les rows applicatives (ex: email_change_otp_codes)
    // quand le user parent est supprimé. Si un cas concret de row sans cascade FK
    // apparaît, ajouter cleanupAllTrackedRows.
    await cleanupAllTrackedUsers(ctx);
  },
});

export { expect } from '@playwright/test';

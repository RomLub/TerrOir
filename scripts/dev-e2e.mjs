#!/usr/bin/env node
/**
 * dev-e2e — Démarre `next dev` avec les env vars e2e activées.
 *
 * USAGE EXCLUSIF Playwright (lance via webServer.command playwright.config.ts).
 * Ne PAS utiliser pour le développement quotidien (les bypass rate-limit +
 * RESEND_TEST_MODE altèrent le comportement réel des routes auth/email).
 *
 * Garde-fous :
 *   1. Refuse de démarrer si port 3000 déjà occupé (fail-fast). Évite le
 *      fallback silencieux de Next.js sur 3001 qui ferait que Playwright
 *      tape la mauvaise URL via baseURL=3000.
 *   2. Pose 4 env vars critiques inline (RESEND_TEST_MODE, PLAYWRIGHT_TEST,
 *      RATE_LIMIT_BYPASS_TESTS, NODE_ENV=test).
 *
 * NB : NODE_ENV=test peut surprendre. Next.js dev tolère 'development' OU
 * 'test' — la convention TerrOir est 'test' pour ce flow car c'est cohérent
 * avec le triple gate rate-limit qui exige NODE_ENV !== 'production'. Les
 * pages chargent normalement, juste les flags d'override e2e sont actifs.
 */

import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT ?? 3000);

function checkPortFree(port) {
  return new Promise((resolve, reject) => {
    const tester = createServer()
      .once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          reject(err);
        }
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

async function main() {
  const free = await checkPortFree(PORT);
  if (!free) {
    console.error(
      `[dev-e2e] Port ${PORT} déjà occupé. Refus de démarrer (fail-fast).\n` +
      `  Action : kill le process qui tient ${PORT} (ex: \`npx kill-port ${PORT}\` ou Ctrl+C dans le terminal qui le tient) puis relance.\n` +
      `  Fail-fast volontaire : Next.js fallback sur 3001 + Playwright baseURL=3000 = ERR_CONNECTION_REFUSED silencieux sur tous les tests.`,
    );
    process.exit(1);
  }

  console.log(`[dev-e2e] Port ${PORT} libre, démarrage Next dev avec env e2e...`);

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    RESEND_TEST_MODE: 'true',
    PLAYWRIGHT_TEST: '1',
    RATE_LIMIT_BYPASS_TESTS: 'true',
  };

  // Spawn `next dev` via npx. Sur Windows, Node.js spawn ne résout pas les
  // .cmd/.bat sans shell → shell: true obligatoire (sinon spawn EINVAL).
  // Sur Linux/macOS shell: false (plus safe, pas d'interpolation).
  const isWindows = process.platform === 'win32';
  const child = spawn('npx', ['--no-install', 'next', 'dev'], {
    env,
    stdio: 'inherit',
    shell: isWindows,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Forward signaux pour shutdown propre (Playwright kill via SIGTERM)
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

main().catch((err) => {
  console.error(`[dev-e2e] erreur fatale : ${err.message}`);
  process.exit(1);
});

/**
 * Helper login UI partagé pour tests reachability (Phase 5 cycle e2e).
 *
 * Doctrine reachability stricte :
 *   - Tests reachability INTERDITS d'utiliser loginAs() (helper qui shortcut
 *     l'auth via UI form mais reste un helper unique). Les autres
 *     shortcuts (storageState, createTestUser sans login UI) sont aussi
 *     interdits.
 *   - Le user est créé via createTestUser (auth.admin → INSERT public.users),
 *     mais le LOGIN se fait obligatoirement via traversal du form
 *     /connexion pour tester la chaîne réelle inscription-form ↔ navbar.
 *
 * Apprentissage cycle 2026-05-07 : un bug navbar (CTA "S'inscrire" sauté
 * par refactor DS terra commit 187b82e) a passé 112 tests Phase 1-3 e2e
 * parce que tous les flows authentifiés bypass le UI. Ce helper est la
 * remédiation : il garantit que chaque test reachability authentifié
 * traverse réellement /connexion → /compte (ou autre cible).
 */

import type { Page } from '@playwright/test';

export async function loginViaUIForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/connexion');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Se connecter', exact: true })
    .click();
  // Marqueur de fin : on quitte /connexion (resolvePostLoginPath redirige
  // vers /compte par défaut consumer ; ?redirectTo respecté si fourni amont).
  await page.waitForURL((url) => !url.pathname.startsWith('/connexion'), {
    timeout: 15_000,
  });
}

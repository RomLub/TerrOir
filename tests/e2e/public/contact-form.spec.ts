/**
 * Phase 2 — formulaire de contact public anon.
 *
 * Couvre POST /api/contact (cf. app/api/contact/route.tsx) :
 *   1. happy path → 200 + ok=true (consomme 1 envoi Resend par run, le
 *      flag RESEND_TEST_MODE ne court-circuite PAS cette route — elle
 *      appelle resend.emails.send direct sans passer par sendTemplate).
 *   2. honeypot rempli → 200 silencieux + ok=true (mais pas d'envoi
 *      réel, le code branche avant le bloc Resend).
 *   3. validation message <20 chars → 400.
 *
 * NB : la table test_emails_captured n'est PAS alimentée par cette
 * route, donc pas d'assertion mailbox ici (uniquement HTTP status).
 *
 * Rate-limit applicatif 3/h/IP : si la suite tourne >3 fois en moins
 * d'une heure depuis la même IP, le 4e happy path retourne 429.
 * Acceptable en dev local, à monitorer en CI si flakiness.
 */

import { test, expect } from '../helpers/test-context';
import { generateTestEmail } from '../helpers/guards';

test.describe('formulaire contact public anon', () => {
  test('happy path : POST /api/contact valide → 200', async ({ page }) => {
    const email = generateTestEmail('contact-happy');
    const response = await page.request.post('/api/contact', {
      data: {
        sujet: 'question',
        nom: 'Playwright Test User',
        email,
        message:
          'Ceci est un message de test e2e Playwright contenant plus de vingt caractères pour passer la validation Zod.',
        consent: true,
      },
    });
    // Tolérant 200 (envoi OK) ou 429 (rate-limit IP atteint après >3 runs/h).
    // Si 502, c'est un fail réseau Resend (à investiguer hors-test).
    const status = response.status();
    if (status === 429) {
      test.info().annotations.push({
        type: 'note',
        description: 'rate-limit 3/h/IP atteint — happy path skip soft',
      });
      return;
    }
    expect(status, `contact POST: ${await response.text()}`).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('honeypot rempli → 200 silencieux (pas d\'envoi)', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: {
        sujet: 'question',
        nom: 'Bot Pretend',
        email: generateTestEmail('contact-honeypot'),
        message:
          'Ce message bot devrait être avalé silencieusement par le honeypot, sans envoi Resend ni audit log.',
        consent: true,
        // Honeypot : champ qui ne devrait JAMAIS être rempli par un humain.
        website: 'http://spam-bot-trap.example.com',
      },
    });
    expect(response.status(), 'honeypot must 200 silently').toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test('validation : message <20 chars → 400', async ({ page }) => {
    const response = await page.request.post('/api/contact', {
      data: {
        sujet: 'question',
        nom: 'Playwright Test User',
        email: generateTestEmail('contact-shortmsg'),
        message: 'Trop court',
        consent: true,
      },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error.length).toBeGreaterThan(0);
  });
});

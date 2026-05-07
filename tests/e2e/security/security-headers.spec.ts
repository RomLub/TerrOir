/**
 * E2E security/security-headers — vérifie que les headers de sécurité posés
 * par next.config.js (audit PCI SAQ-A W-1) sont effectivement servis sur
 * les routes publiques.
 *
 * Headers attendus (cf. next.config.js SECURITY_HEADERS) :
 *   - X-Frame-Options: DENY
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Permissions-Policy: camera=(), microphone=(), ...
 *   - Content-Security-Policy: default-src 'self'; ...; frame-ancestors 'none'
 *
 * Couverture (1 test, plusieurs assertions) : check sur la home publique
 * (/) — toutes les routes héritent du header `source: "/:path*"` donc /
 * est représentatif.
 */

import { test, expect } from '../helpers/test-context';

test.describe('Security — security headers', () => {
  test('GET / → headers X-Frame-Options + nosniff + CSP + Referrer-Policy', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const response = await page.goto('/');
    expect(response, 'navigation /').not.toBeNull();
    expect(response!.status(), 'GET / doit retourner 200').toBe(200);

    const headers = response!.headers();

    // X-Frame-Options : DENY (anti-clickjacking, Stripe iframes sont
    // chargées DEPUIS js.stripe.com pas embed de TerrOir → DENY OK).
    expect(
      headers['x-frame-options'],
      'X-Frame-Options DENY manquant',
    ).toMatch(/^DENY$/i);

    // X-Content-Type-Options : nosniff (anti-MIME-confusion).
    expect(
      headers['x-content-type-options'],
      'X-Content-Type-Options nosniff manquant',
    ).toMatch(/^nosniff$/i);

    // Referrer-Policy : strict-origin-when-cross-origin (pas de leak URL
    // sur HTTP downgrade).
    expect(
      headers['referrer-policy'],
      'Referrer-Policy strict-origin-when-cross-origin manquant',
    ).toBe('strict-origin-when-cross-origin');

    // Permissions-Policy : doit contenir camera=() et microphone=() au
    // minimum (opt-out features non utilisées).
    expect(
      headers['permissions-policy'] ?? '',
      'Permissions-Policy camera=()/microphone=() manquant',
    ).toMatch(/camera=\(\)/);
    expect(headers['permissions-policy'] ?? '').toMatch(/microphone=\(\)/);

    // Content-Security-Policy : doit contenir frame-ancestors 'none'
    // (équivalent CSP de X-Frame-Options DENY) + default-src 'self'.
    // Le header peut être Content-Security-Policy ou
    // Content-Security-Policy-Report-Only selon l'env (cf. comment dans
    // next.config.js mentionnant la phase rollout). On accepte les 2.
    const csp =
      headers['content-security-policy'] ??
      headers['content-security-policy-report-only'] ??
      '';
    expect(csp, 'CSP header manquant').not.toBe('');
    expect(csp, "CSP doit contenir frame-ancestors 'none'").toContain(
      "frame-ancestors 'none'",
    );
    expect(csp, "CSP doit contenir default-src 'self'").toContain(
      "default-src 'self'",
    );
    expect(csp, "CSP doit contenir object-src 'none'").toContain(
      "object-src 'none'",
    );
  });
});

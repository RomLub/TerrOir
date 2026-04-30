/**
 * Garde-fous emails pour tests E2E TerrOir.
 *
 * Stratégie 2 couches :
 *   1. ALLOW-LIST par pattern : seul ^playwright-test-\d+(-suffix)?@mailinator\.com$
 *      est autorisé. Toute autre email throw immédiatement.
 *   2. DENY-LIST backup (ceinture + bretelles) : 4 emails personnels
 *      hardcodés qui throw même s'ils matchaient l'allow-list (impossible
 *      en théorie mais log ultra-visible si jamais ça arrive).
 *
 * Tous les writes Supabase admin passent par les helpers safe* qui
 * appellent assertSafeEmail() avant exécution.
 */

const ALLOW_PATTERN = /^playwright-test-\d+(-[a-z0-9-]+)?@mailinator\.com$/;

const EXTRA_PROTECTED_EMAILS = new Set<string>([
  'lubin.rom@gmail.com',
  'lubin.rom.ad@gmail.com',
  'amandine.lubin7218@gmail.com',
  'hemery.chlo@gmail.com',
]);

export class ProtectedEmailError extends Error {
  constructor(public readonly email: string, public readonly reason: string) {
    super(
      `\n\n` +
      `🛑 PROTECTED EMAIL HIT 🛑\n` +
      `   email  = ${email}\n` +
      `   reason = ${reason}\n` +
      `   Operation refusée. Vérifier le test, ne JAMAIS désactiver ce guard.\n`
    );
    this.name = 'ProtectedEmailError';
  }
}

/**
 * Vérifie qu'un email est safe à toucher (création, update, delete).
 * Throw si non-safe. Ne renvoie rien si OK.
 */
export function assertSafeEmail(email: unknown): void {
  if (typeof email !== 'string' || email.length === 0) {
    throw new ProtectedEmailError(String(email), 'email vide ou non-string');
  }

  const normalized = email.toLowerCase().trim();

  // Couche 2 (deny-list backup) — checkée AVANT l'allow-list pour log explicite
  if (EXTRA_PROTECTED_EMAILS.has(normalized)) {
    throw new ProtectedEmailError(
      normalized,
      'email dans EXTRA_PROTECTED_EMAILS (deny-list backup hardcodée)',
    );
  }

  // Couche 1 (allow-list par pattern)
  if (!ALLOW_PATTERN.test(normalized)) {
    throw new ProtectedEmailError(
      normalized,
      `ne match pas le pattern ${ALLOW_PATTERN.source}`,
    );
  }
}

/**
 * Génère un email test conforme au pattern allow-list.
 * Format : playwright-test-{timestamp}[-{suffix}]@mailinator.com
 * @param suffix Optionnel, alphanumeric + tirets uniquement
 */
export function generateTestEmail(suffix?: string): string {
  const ts = Date.now();
  const cleanSuffix = suffix
    ? '-' + suffix.toLowerCase().replace(/[^a-z0-9-]/g, '')
    : '';
  return `playwright-test-${ts}${cleanSuffix}@mailinator.com`;
}

// Export pour tests unitaires uniquement
export const __TEST_ONLY__ = {
  ALLOW_PATTERN,
  EXTRA_PROTECTED_EMAILS,
};

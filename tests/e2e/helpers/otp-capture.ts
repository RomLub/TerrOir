/**
 * Helper de capture/seed d'OTP pour tests E2E ChangeEmailSection.
 *
 * Stratégie hybride (validée avec Romain) :
 *
 *   - Pour tester verifyOtp + completeEmailChange : SEED un OTP en DB
 *     directement (DELETE rows existants pour le tuple (user_id, step)
 *     puis INSERT row avec hash de notre code clair). Permet de
 *     contrôler le code saisi côté UI sans dépendre de Resend/mailinator.
 *
 *   - Pour tester requestOtp : pas de capture du code (le HMAC est
 *     irréversible côté serveur). À la place, vérifier qu'un row a
 *     été créé en DB et qu'un audit log 'account_otp_requested' a
 *     été émis (Option C).
 *
 * Note phase 2 : un smoke test mailinator dédié validera la chaîne
 * email end-to-end. Hors scope ici.
 */

import { TestContext, safeDelete, safeInsert, getReadOnlyAdminClient, trackId } from './supabase-admin';

// ============================================================================
// MIRROR de lib/email-change/hmac.ts (algo HMAC-SHA256)
// ----------------------------------------------------------------------------
// À supprimer quand T-019 (refacto hmac-pure) sera mergé.
// Toute modification ici doit être répliquée côté prod IMMÉDIATEMENT.
// Algo de référence : HMAC-SHA256(secret, code), output hex 64 chars.
// ============================================================================

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  const SECRET = process.env.EMAIL_CHANGE_OTP_SECRET;
  if (!SECRET) {
    throw new Error(
      'EMAIL_CHANGE_OTP_SECRET manquant dans .env.local. ' +
      'Cette variable est requise pour les tests E2E qui seedent des OTP en DB.',
    );
  }
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw',
      encoder.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return keyPromise;
}

/**
 * Reset du keyPromise singleton. Utilisé par les tests vitest pour
 * isoler les cas qui mockent EMAIL_CHANGE_OTP_SECRET.
 */
export function __resetHmacKey(): void {
  keyPromise = null;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Calcule le HMAC-SHA256 du code OTP. Doit produire le même hash que
 * lib/email-change/hmac.ts:hashOtp côté serveur.
 */
export async function hashOtp(code: string): Promise<string> {
  const key = await getKey();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(code));
  return bytesToHex(new Uint8Array(signature));
}

// ============================================================================
// MIRROR de lib/email-change/otp.ts:generateOtp (algo OTP 6 chiffres)
// ----------------------------------------------------------------------------
// Même mirror que ci-dessus, supprimer avec T-019 si exposé via hmac-pure
// ou un module otp-pure équivalent.
// ============================================================================

const OTP_DIGITS = 6;
const MODULO = 10 ** OTP_DIGITS;
const MAX_VALID = Math.floor(2 ** 32 / MODULO) * MODULO;

/**
 * Génère un OTP 6 chiffres uniformément distribué (rejection sampling).
 * Identique à lib/email-change/otp.ts:generateOtp côté serveur.
 */
export function generateOtpCode(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= MAX_VALID);
  return (n % MODULO).toString().padStart(OTP_DIGITS, '0');
}

// ============================================================================
// Helpers publics
// ============================================================================

export interface SeedOtpOptions {
  userId: string;
  step: 'current' | 'new';
  /** Email destinataire de l'OTP. Pour step='current' : ancien email du user.
   *  Pour step='new' : nouveau email cible. */
  email: string;
  /** Code OTP en clair. Si omis, généré aléatoirement via generateOtpCode(). */
  code?: string;
  /** Validité en secondes. Default 600 (10 min, comme côté serveur). */
  expiresInSeconds?: number;
  /** Attempts initial. Default 0. */
  attempts?: number;
}

export interface SeededOtp {
  /** Code OTP en clair, à saisir dans l'UI Playwright. */
  code: string;
  /** UUID du row créé en DB. */
  rowId: string;
}

/**
 * SEED un OTP en DB directement, en bypassant requestOtp côté serveur.
 *
 * Workflow :
 *   1. DELETE tous les rows existants pour (user_id, step) — évite l'ambiguïté
 *      ORDER BY created_at DESC du serveur si plusieurs rows actifs cohabitent.
 *   2. INSERT un row avec hash du code clair fourni (ou généré).
 *   3. Track le rowId dans ctx.trackedIds pour cleanup auto.
 *
 * Utilisation typique :
 *   const { code } = await seedOtp(ctx, { userId, step: 'current', email: oldEmail });
 *   await page.locator('input[name="code"]').fill(code);
 *   await page.locator('button[type="submit"]').click();
 *   // Le serveur valide via verifyHash(code, row.code_hash) → match → consumed_at
 */
export async function seedOtp(ctx: TestContext, opts: SeedOtpOptions): Promise<SeededOtp> {
  const code = opts.code ?? generateOtpCode();
  const expiresInSeconds = opts.expiresInSeconds ?? 600;
  const attempts = opts.attempts ?? 0;

  // 1. DELETE rows existants pour (user_id, step). Le user_id doit être tracké
  //    (vérifié par safeDelete via validateFilterIdTracking).
  await safeDelete(ctx, 'email_change_otp_codes', {
    user_id: opts.userId,
    step: opts.step,
  });

  // 2. Compute hash et INSERT
  const codeHash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

  const result = await safeInsert<{ id: string }>(
    ctx,
    'email_change_otp_codes',
    {
      user_id: opts.userId,
      step: opts.step,
      email: opts.email,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts,
    },
    { returning: true },
  );

  if (result.error || !result.data) {
    throw new Error(
      `seedOtp INSERT failed: ${JSON.stringify(result.error ?? 'no data returned')}`,
    );
  }

  const inserted = Array.isArray(result.data) ? result.data[0] : result.data;
  const rowId = (inserted as { id: string }).id;
  if (!rowId) {
    throw new Error(`seedOtp: row inséré sans id retourné (returning: true mal géré ?)`);
  }

  // 3. Track le rowId pour cleanup auto en afterEach
  trackId(ctx, rowId);

  return { code, rowId };
}

export interface AssertOtpRowOptions {
  userId: string;
  step: 'current' | 'new';
  /** Si défini, vérifie l'état consumed_at :
   *    true  → consumed_at NOT NULL
   *    false → consumed_at IS NULL */
  consumed?: boolean;
  /** Si défini, vérifie attempts === expectedAttempts */
  expectedAttempts?: number;
}

/**
 * Vérifie qu'un row OTP existe en DB avec l'état attendu.
 * Utilisé pour valider qu'un test a bien produit le state DB attendu.
 *
 * Throw avec message explicite si la condition n'est pas remplie.
 */
export async function assertOtpRowExists(
  ctx: TestContext,
  opts: AssertOtpRowOptions,
): Promise<void> {
  const client = getReadOnlyAdminClient();
  const { data, error } = await client
    .from('email_change_otp_codes')
    .select('id, user_id, step, consumed_at, attempts, created_at')
    .eq('user_id', opts.userId)
    .eq('step', opts.step)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`assertOtpRowExists query failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      `assertOtpRowExists: aucun row trouvé pour user_id=${opts.userId}, step=${opts.step}`,
    );
  }

  if (opts.consumed === true && data.consumed_at === null) {
    throw new Error(
      `assertOtpRowExists: row trouvé mais consumed_at IS NULL (attendu: consommé). row.id=${data.id}`,
    );
  }
  if (opts.consumed === false && data.consumed_at !== null) {
    throw new Error(
      `assertOtpRowExists: row trouvé mais consumed_at NOT NULL (attendu: non consommé). row.id=${data.id}, consumed_at=${data.consumed_at}`,
    );
  }
  if (opts.expectedAttempts !== undefined && data.attempts !== opts.expectedAttempts) {
    throw new Error(
      `assertOtpRowExists: attempts attendu ${opts.expectedAttempts}, observé ${data.attempts}. row.id=${data.id}`,
    );
  }
}

export type AuthEventType =
  | 'account_otp_requested'
  | 'account_otp_verified'
  | 'account_otp_invalid'
  | 'account_otp_expired'
  | 'account_otp_attempts_exceeded'
  | 'account_email_change_completed';

export interface AssertAuditLogOptions {
  userId: string;
  eventType: AuthEventType;
  /** Si défini, exige au moins N events de ce type pour cet user. Default 1. */
  minCount?: number;
  /** Si défini, fenêtre temporelle : events après ce timestamp. */
  sinceTimestamp?: string;
}

/**
 * Vérifie qu'un audit log d'event_type donné existe pour le user.
 * Utilisé notamment pour valider Option C : "requestOtp a tourné côté serveur"
 * sans avoir besoin de lire le mail Resend.
 *
 * Throw avec message explicite si la condition n'est pas remplie.
 */
export async function assertAuditLogContains(
  ctx: TestContext,
  opts: AssertAuditLogOptions,
): Promise<void> {
  const minCount = opts.minCount ?? 1;
  const client = getReadOnlyAdminClient();

  let query = client
    .from('audit_logs')
    .select('id, event_type, user_id, created_at, metadata', { count: 'exact' })
    .eq('user_id', opts.userId)
    .eq('event_type', opts.eventType);

  if (opts.sinceTimestamp) {
    query = query.gte('created_at', opts.sinceTimestamp);
  }

  const { data, count, error } = await query;

  if (error) {
    throw new Error(`assertAuditLogContains query failed: ${error.message}`);
  }
  const actualCount = count ?? data?.length ?? 0;
  if (actualCount < minCount) {
    throw new Error(
      `assertAuditLogContains: event_type='${opts.eventType}' pour user ${opts.userId} ` +
      `attendu >= ${minCount} fois, observé ${actualCount} fois.`,
    );
  }
}

/**
 * Helper pratique : récupère le timestamp courant ISO pour borner
 * une fenêtre d'observation d'audit logs.
 *
 *   const t0 = nowIsoForAudit();
 *   await page.click('button[name="submit"]');
 *   await assertAuditLogContains(ctx, { userId, eventType: 'account_otp_requested', sinceTimestamp: t0 });
 */
export function nowIsoForAudit(): string {
  return new Date().toISOString();
}

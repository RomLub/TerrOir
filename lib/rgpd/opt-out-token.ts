import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

// HMAC-SHA256 déterministe pour l'opt-out des leads producer_interests
// (chantier RGPD, avril 2026). Token calculé à partir de l'email normalisé
// + OPT_OUT_TOKEN_SECRET. Aucun stockage DB requis : le token peut être
// recomputé à la vérification. Rotation du secret = invalidation de tous
// les liens envoyés précédemment.

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getSecret(): string {
  const secret = process.env.OPT_OUT_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      'OPT_OUT_TOKEN_SECRET is not set — cannot generate/verify opt-out tokens',
    );
  }
  return secret;
}

export function generateOptOutToken(email: string): string {
  const hmac = createHmac('sha256', getSecret());
  hmac.update(normalizeEmail(email));
  return hmac.digest('hex').slice(0, 32);
}

export function verifyOptOutToken(email: string, token: string): boolean {
  if (typeof token !== 'string' || token.length !== 32) return false;
  if (!/^[0-9a-f]{32}$/.test(token)) return false;
  const expected = generateOptOutToken(email);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(token, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

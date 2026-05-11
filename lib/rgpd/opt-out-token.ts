import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

// HMAC-SHA256 sur (emailNormalisé|expiresAtMs) pour les liens opt-out
// producer_interests (chantier RGPD avril 2026, durcissement F-027 audit
// pré-launch 2026-05).
//
// Format token (string URL-safe) : `<expiresAtMs>.<hex16>`
//   - expiresAtMs : timestamp Unix ms d'expiration (lisible côté serveur
//     pour distinguer "invalide" de "expiré" et logger forensique).
//   - hex16 : 32 caractères hex (HMAC tronqué sur 16 bytes = 128 bits,
//     largement assez pour un opt-out lien non-secret).
//
// Avant F-027 : token = HMAC déterministe `<hex32>` sans expiration → un
// lien envoyé dans un email leak (forwardé, archivé, screenshot) restait
// valide ad vitam tant que `OPT_OUT_TOKEN_SECRET` n'était pas rotaté.
// Maintenant : TTL 30 jours embarqué + vérifié dans verifyOptOutToken.
//
// Rotation du secret = invalidation de TOUS les liens en circulation (les
// HMAC ne valideront plus). Comportement préservé.

const OPT_OUT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

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

function computeHmac(email: string, expiresAtMs: number): string {
  const hmac = createHmac('sha256', getSecret());
  hmac.update(`${normalizeEmail(email)}|${expiresAtMs}`);
  // Troncature 32 hex (= 16 bytes = 128 bits) suffisante pour un opt-out
  // lien (pas un secret cryptographique, signal non-secret protégé par
  // unforgeable HMAC).
  return hmac.digest('hex').slice(0, 32);
}

export type GeneratedOptOutToken = {
  token: string;
  expiresAt: Date;
};

/**
 * Génère un token opt-out signé HMAC avec TTL embarqué (30 jours par défaut).
 * Le format `<expiresAtMs>.<hex16>` est URL-safe et ne nécessite aucun
 * storage DB (vérification idempotente côté serveur via re-computation
 * du HMAC).
 *
 * @param email Email associé au token (sera normalisé : trim + lowercase)
 * @param nowMs Override testable du timestamp courant (default: Date.now())
 */
export function generateOptOutToken(
  email: string,
  nowMs: number = Date.now(),
): GeneratedOptOutToken {
  const expiresAtMs = nowMs + OPT_OUT_TOKEN_TTL_MS;
  const hex = computeHmac(email, expiresAtMs);
  return {
    token: `${expiresAtMs}.${hex}`,
    expiresAt: new Date(expiresAtMs),
  };
}

export type OptOutTokenVerificationResult =
  | { valid: true; email: string; expiresAt: Date }
  | { valid: false; expired: boolean };

/**
 * Vérifie un token opt-out :
 *  - parsing format `<ts>.<hex16>` (sinon invalid, expired=false)
 *  - re-computation HMAC avec email + ts (sinon invalid, expired=false)
 *  - check ts > now() (sinon invalid, expired=true)
 *
 * Toutes les comparaisons utilisent `timingSafeEqual` (resistance à un
 * éventuel timing-attack même si le risque est faible vu le flow).
 *
 * @param email Email candidat (sera normalisé : trim + lowercase)
 * @param token Token à vérifier (querystring user-provided)
 * @param nowMs Override testable du timestamp courant (default: Date.now())
 */
export function verifyOptOutToken(
  email: string,
  token: string,
  nowMs: number = Date.now(),
): OptOutTokenVerificationResult {
  if (typeof token !== 'string') return { valid: false, expired: false };

  const dot = token.indexOf('.');
  if (dot <= 0 || dot >= token.length - 1) {
    return { valid: false, expired: false };
  }
  const tsPart = token.slice(0, dot);
  const hexPart = token.slice(dot + 1);

  // Le timestamp doit être un entier positif. On rejette early si parse
  // échoue (NaN, vide, lettres). Pas de notion d'expiration sans ts valide.
  if (!/^\d{10,16}$/.test(tsPart)) return { valid: false, expired: false };
  const expiresAtMs = Number(tsPart);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
    return { valid: false, expired: false };
  }

  if (hexPart.length !== 32 || !/^[0-9a-f]{32}$/.test(hexPart)) {
    return { valid: false, expired: false };
  }

  const expected = computeHmac(email, expiresAtMs);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hexPart, 'hex');
  if (a.length !== b.length) return { valid: false, expired: false };
  if (!timingSafeEqual(a, b)) return { valid: false, expired: false };

  // HMAC OK → distinguer "expiré" de "valide"
  if (expiresAtMs <= nowMs) {
    return { valid: false, expired: true };
  }

  return {
    valid: true,
    email: normalizeEmail(email),
    expiresAt: new Date(expiresAtMs),
  };
}

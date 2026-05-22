import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Chantier 3 (Leads) — Phase 2.2 : lien personnel pré-rempli pour un lead
// (prospecté ou spontané). HMAC-SHA256 sur (lead_id|expiresAtMs).
//
// Format token (string URL-safe) : `<lead_id>.<expiresAtMs>.<hex32>`
//   - lead_id : UUID du producer_interests (sans point → séparateur sûr).
//   - expiresAtMs : timestamp Unix ms d'expiration (lisible serveur pour
//     distinguer "invalide" de "expiré").
//   - hex32 : HMAC tronqué 16 bytes (128 bits) — lien non-secret, signature
//     infalsifiable suffisante.
//
// Double garde-fou (cf. route /devenir-producteur, Phase 2.3) :
//   1. Signature HMAC vérifiée ici (infalsifiable, stateless).
//   2. Le token est AUSSI persisté dans producer_interests.prefill_token +
//      prefill_token_expires_at. La route vérifie que le token présenté ==
//      la valeur stockée pour ce lead → permet la révocation (admin
//      ré-envoie → nouveau token → l'ancien ne matche plus la colonne) même
//      si son HMAC reste cryptographiquement valide jusqu'à expiration.
//
// Validité : 30 jours (aligné `Lien personnel valable 30 jours` dans l'email
// d'envoi formulaire prospect, et la colonne prefill_token_expires_at).
//
// Rotation de LEAD_PREFILL_TOKEN_SECRET = invalidation de tous les liens en
// circulation (les HMAC ne valideront plus).

const PREFILL_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSecret(): string {
  const secret = process.env.LEAD_PREFILL_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "LEAD_PREFILL_TOKEN_SECRET is not set — cannot generate/verify lead prefill tokens",
    );
  }
  return secret;
}

function computeHmac(leadId: string, expiresAtMs: number): string {
  const hmac = createHmac("sha256", getSecret());
  hmac.update(`${leadId.toLowerCase()}|${expiresAtMs}`);
  return hmac.digest("hex").slice(0, 32);
}

export type GeneratedPrefillToken = {
  token: string;
  expiresAt: Date;
};

/**
 * Génère un token prefill signé HMAC pour un lead, TTL 30 jours embarqué.
 *
 * @param leadId UUID du producer_interests
 * @param nowMs  Override testable du timestamp courant (default: Date.now())
 */
export function generatePrefillToken(
  leadId: string,
  nowMs: number = Date.now(),
): GeneratedPrefillToken {
  if (!UUID_RE.test(leadId)) {
    throw new Error("generatePrefillToken: leadId invalide (UUID attendu)");
  }
  const expiresAtMs = nowMs + PREFILL_TOKEN_TTL_MS;
  const hex = computeHmac(leadId, expiresAtMs);
  return {
    token: `${leadId.toLowerCase()}.${expiresAtMs}.${hex}`,
    expiresAt: new Date(expiresAtMs),
  };
}

export type PrefillTokenVerificationResult =
  | { valid: true; leadId: string; expiresAt: Date }
  | { valid: false; expired: boolean };

/**
 * Vérifie un token prefill (signature + expiration). Ne fait PAS le check de
 * correspondance avec la colonne DB (révocation) — c'est la responsabilité de
 * la route appelante après lookup du lead.
 *
 * @param token Token à vérifier (querystring user-provided)
 * @param nowMs Override testable du timestamp courant (default: Date.now())
 */
export function verifyPrefillToken(
  token: string,
  nowMs: number = Date.now(),
): PrefillTokenVerificationResult {
  if (typeof token !== "string") return { valid: false, expired: false };

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, expired: false };
  const [leadId, tsPart, hexPart] = parts as [string, string, string];

  if (!UUID_RE.test(leadId)) return { valid: false, expired: false };
  if (!/^\d{10,16}$/.test(tsPart)) return { valid: false, expired: false };
  const expiresAtMs = Number(tsPart);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
    return { valid: false, expired: false };
  }
  if (hexPart.length !== 32 || !/^[0-9a-f]{32}$/.test(hexPart)) {
    return { valid: false, expired: false };
  }

  const expected = computeHmac(leadId, expiresAtMs);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hexPart, "hex");
  if (a.length !== b.length) return { valid: false, expired: false };
  if (!timingSafeEqual(a, b)) return { valid: false, expired: false };

  if (expiresAtMs <= nowMs) {
    return { valid: false, expired: true };
  }

  return {
    valid: true,
    leadId: leadId.toLowerCase(),
    expiresAt: new Date(expiresAtMs),
  };
}

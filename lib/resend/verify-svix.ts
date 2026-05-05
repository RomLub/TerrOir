import "server-only";
import crypto from "node:crypto";

// Audit Email H-3 (2026-05-05) — vérification signature Svix pour webhooks
// Resend entrants. Implémentation manuelle HMAC-SHA256 plutôt que dépendance
// `svix` npm : ~30 lignes, surface réduite, pas de nouveau lockfile entry.
//
// Spec officielle Svix (https://docs.svix.com/receiving/verifying-payloads/how-manual) :
//   1. Lire les 3 headers : svix-id, svix-timestamp (Unix seconds),
//      svix-signature (espace-séparé : "v1,base64Sig1 v1,base64Sig2 ...").
//   2. Construire la string signée : `${svix-id}.${svix-timestamp}.${rawBody}`.
//   3. Strip le préfixe `whsec_` du secret, base64-decode → key bytes.
//   4. HMAC-SHA256(stringSignée, keyBytes) → base64 → expectedSig.
//   5. Pour chaque signature `v1,sig` du header, comparer en timing-safe
//      avec expectedSig. Au moins une match → OK.
//   6. Vérifier timestamp dans tolérance ±5 min (anti-replay).
//
// Format Resend (constaté Dashboard) : RESEND_WEBHOOK_SECRET livré comme
// `whsec_BASE64STRING`. Si jamais on reçoit une variante sans préfixe, on
// supporte les deux : strip conditionnel.

const TOLERANCE_SECONDS = 5 * 60; // 5 min tolerance anti-replay

export interface SvixHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_secret"
        | "missing_headers"
        | "invalid_timestamp"
        | "timestamp_out_of_tolerance"
        | "no_valid_signature";
    };

export function readSvixHeaders(headers: Headers): SvixHeaders | null {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return null;
  return { id, timestamp, signature };
}

function decodeSecret(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

export function verifySvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  nowMs: number = Date.now(),
): VerifyResult {
  if (!secret) return { ok: false, reason: "missing_secret" };

  const tsNum = Number(headers.timestamp);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const drift = Math.abs(nowMs / 1000 - tsNum);
  if (drift > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const key = decodeSecret(secret);
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(signedContent, "utf8")
    .digest("base64");

  // svix-signature peut contenir plusieurs signatures lors d'une rotation
  // de clé (envoie l'ancienne ET la nouvelle). On cherche un match parmi
  // les variants `v1,...`. Comparaison timing-safe pour empêcher les
  // attaques par mesure de temps.
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  const candidates = headers.signature.split(" ");
  for (const candidate of candidates) {
    const idx = candidate.indexOf(",");
    if (idx < 0) continue;
    const version = candidate.slice(0, idx);
    if (version !== "v1") continue;
    const sig = candidate.slice(idx + 1);
    const sigBuf = Buffer.from(sig, "utf8");
    if (sigBuf.length !== expectedBuf.length) continue;
    if (crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "no_valid_signature" };
}

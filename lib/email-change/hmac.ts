import "server-only";

// =============================================================================
// HMAC helper for email change OTP codes (T-013 PR2)
// =============================================================================
// Web Crypto API (crypto.subtle) — Edge Runtime + Node 16+ compatible.
// Aligné T-321 pattern Web Crypto async (vs Node-only require('crypto')).
//
// Fail-fast au module-load : EMAIL_CHANGE_OTP_SECRET absent → throw immédiat
// (pattern T-328 / T-325 / T-305 PR-A). Évite qu'un build silencieux mène à
// des hash signés avec un secret undefined → préimage triviale possible.
//
// Constant-time compare en pure JS (XOR byte-by-byte sans early exit) car
// crypto.subtle ne fournit pas timingSafeEqual côté Web Crypto (Node-only
// helper). Loop fixe sur la longueur réelle, retourne false si tailles
// différentes — la longueur d'un HMAC-SHA256 hex est toujours 64, donc
// non-secrète.
//
// Singleton key import : crypto.subtle.importKey est async + non-trivial.
// On cache la promise pour éviter le re-import à chaque hashOtp/verifyHash.
// =============================================================================

const SECRET = process.env.EMAIL_CHANGE_OTP_SECRET;
if (!SECRET) {
  throw new Error(
    "EMAIL_CHANGE_OTP_SECRET environment variable is required (T-013 PR2)",
  );
}

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(SECRET as string),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return keyPromise;
}

// HMAC-SHA256 du code OTP, sortie hex 64 caractères. Persisté en DB comme
// `code_hash` (jamais le code en clair).
export async function hashOtp(code: string): Promise<string> {
  const key = await getKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(code));
  return bytesToHex(new Uint8Array(signature));
}

// Verify constant-time : recalcule le HMAC du code soumis et compare au
// hash attendu byte-by-byte sans early exit sur le diff.
export async function verifyHash(
  code: string,
  expectedHash: string,
): Promise<boolean> {
  const computed = await hashOtp(code);
  return constantTimeEqual(computed, expectedHash);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

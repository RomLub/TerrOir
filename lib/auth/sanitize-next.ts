// Helper hardened pour sanitize ?next= query param du callback OTP
// (magic link, signup, invite, recovery). Defense in depth : reject paths
// absolus, protocol-relative (// ou /\), schemes dangereux
// (javascript/data/file/vbscript), control chars (CRLF + null + tab).
//
// Cohérent avec sister helper isValidRedirectPath (post-login-redirect.ts)
// qui filtre ?redirectTo= et couvrait déjà /\\ (asymétrie historique
// fixée — finding T-314 audit auth).
//
// Logging forensique greppable Vercel format SANITIZE_NEXT_REJECTED
// (cohérent T-318 / T-309 / T-317). Logger raw_length + reason, JAMAIS
// raw verbatim (anti log forging — un payload \r\n pollue le log — et
// anti PII si l'attaquant tente de fuiter une session token via le param).

type SanitizeNextRejectionReason =
  | "empty_or_invalid"
  | "control_chars"
  | "dangerous_scheme"
  | "not_relative"
  | "protocol_relative_slash"
  | "protocol_relative_backslash";

const DANGEROUS_SCHEMES = /^(javascript|data|file|vbscript):/i;
const CONTROL_CHARS = /[\r\n\0\t]/;

function logRejection(
  reason: SanitizeNextRejectionReason,
  rawLength: number,
): void {
  console.warn(
    `[SANITIZE_NEXT_REJECTED] reason=${reason} raw_length=${rawLength}`,
  );
}

export function sanitizeNext(raw: unknown): string | null {
  // Absence d'intent (null / undefined / "") : silencieux. Le param n'a
  // simplement pas été passé, pas une tentative d'attaque à logger.
  if (raw === null || raw === undefined || raw === "") return null;

  if (typeof raw !== "string") {
    logRejection("empty_or_invalid", 0);
    return null;
  }

  const rawLength = raw.length;

  if (CONTROL_CHARS.test(raw)) {
    logRejection("control_chars", rawLength);
    return null;
  }

  if (DANGEROUS_SCHEMES.test(raw)) {
    logRejection("dangerous_scheme", rawLength);
    return null;
  }

  if (!raw.startsWith("/")) {
    logRejection("not_relative", rawLength);
    return null;
  }

  if (raw.startsWith("//")) {
    logRejection("protocol_relative_slash", rawLength);
    return null;
  }

  if (raw.startsWith("/\\")) {
    logRejection("protocol_relative_backslash", rawLength);
    return null;
  }

  return raw;
}

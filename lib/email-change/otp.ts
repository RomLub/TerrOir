import "server-only";

// =============================================================================
// OTP code generator + format validator (T-013 PR2)
// =============================================================================
// Génère un code 6 chiffres bias-free via crypto.getRandomValues + rejection
// sampling. Web Crypto compatible (vs crypto.randomInt qui est Node-only —
// bloquerait Edge Runtime).
//
// Bias-free : un modulo 10^6 sur un Uint32 random introduirait un biais sur
// les valeurs hautes (les codes 0-967295 auraient 1 chance de plus d'être
// tirés que les codes 967296-999999). Rejection sampling élimine ce biais
// (~0.023% des draws rejetés en pratique).
//
// MAX_VALID : plus grand multiple de 10^6 inférieur à 2^32 = 4_294_000_000.
// Tout tirage >= MAX_VALID est rejeté et re-tiré.
// =============================================================================

const OTP_DIGITS = 6;
const MODULO = 10 ** OTP_DIGITS; // 1_000_000
const MAX_VALID = Math.floor(2 ** 32 / MODULO) * MODULO; // 4_294_000_000

export function generateOtp(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= MAX_VALID);
  return (n % MODULO).toString().padStart(OTP_DIGITS, "0");
}

// Format strict : exactement 6 caractères ASCII chiffres. Sans flag /u, \d
// ne matche que [0-9] — full-width digits unicode rejetés (anti-collision
// homoglyphes). Leading zeros préservés.
export function isValidOtpFormat(input: string): boolean {
  return /^\d{6}$/.test(input);
}

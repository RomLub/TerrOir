import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// Rate-limit OTP requests : 3 par 60 secondes par (userId, step)
// =============================================================================
// Q5 PHASE 2.A : limite serveur 3/60s pour éviter le spam OTP / abuse implicite
// (DoS Resend, bruteforce attempts indirect). Comptage DB-based sur
// public.email_change_otp_codes (table créée en PR1).
//
// Q10 PHASE 2.A : identifier rate-limit = userId. Pas d'IP-based — l'user est
// forcément authentifié pour atteindre ce flow (cf. requestOtp action guard
// via getSessionUser).
//
// Comportement sur erreur DB : fail-OPEN (allow) avec console.warn pour trace
// forensique. Justification : la cap 3/60s est défensive vs spam, pas critique
// sécurité (l'attaquant n'apprend rien du rate-limit lui-même). Une DB
// temporairement KO ne doit pas bloquer un user légitime sur un flow rare.
//
// retryAfterSeconds : calculé depuis le plus ancien des CAP rows actifs
// (quand il sortira de la fenêtre 60s). Permet à la UI d'afficher un
// compteur précis ("réessayez dans Xs"). Min 0 si race entre la query
// et le calcul (le plus ancien tombe juste hors fenêtre).
// =============================================================================

const CAP = 3;
const WINDOW_SECONDS = 60;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export async function checkOtpRateLimit(
  userId: string,
  step: "current" | "new",
): Promise<RateLimitResult> {
  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();

  const { data, error } = await admin
    .from("email_change_otp_codes")
    .select("created_at")
    .eq("user_id", userId)
    .eq("step", step)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn(
      `OTP_RATE_LIMIT_DB_WARN user=${userId} step=${step} error=${error.message}`,
    );
    return { ok: true };
  }

  const rows = data ?? [];
  if (rows.length < CAP) {
    return { ok: true };
  }

  const oldestCreatedAt = new Date(rows[0]!.created_at).getTime();
  const expiresAtMs = oldestCreatedAt + WINDOW_SECONDS * 1000;
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((expiresAtMs - Date.now()) / 1000),
  );

  return { ok: false, retryAfterSeconds };
}

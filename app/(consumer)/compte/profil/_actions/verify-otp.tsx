"use server";

// =============================================================================
// Server action : verifyOtp step=current ou step=new (T-013 PR2 C2.6)
// =============================================================================
// Vérifie un code OTP soumis par l'user. Logique :
//
//   1. Auth via getSessionUser
//   2. Validation Zod { step, code } + format check isValidOtpFormat (6 chiffres)
//   3. SELECT latest row non-consommée pour (user, step) (ORDER BY created_at DESC
//      LIMIT 1, maybeSingle)
//   4. Pas de row → reason='no_active' (aucun OTP en cours pour cette étape)
//   5. expires_at < now → audit account_otp_expired + reason='expired'
//   6. Pre-check attempts >= 5 (défensif) → audit attempts_exceeded + force
//      invalidation (consumed_at = now) + reason='attempts_exceeded'
//   7. Verify HMAC constant-time via verifyHash
//      - faux : increment attempts. Si newAttempts atteint 5 → invalidation +
//        audit attempts_exceeded. Sinon → audit account_otp_invalid +
//        attemptsRemaining = 5 - newAttempts
//      - vrai : UPDATE consumed_at = now + audit account_otp_verified +
//        ok: true
//
// Ne déclenche PAS la mutation auth.users.email — c'est le rôle de
// completeEmailChange (C2.7) une fois les 2 verifyOtp validés (current + new).
// =============================================================================

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { verifyHash } from "@/lib/email-change/hmac";
import { isValidOtpFormat } from "@/lib/email-change/otp";

export type VerifyOtpReason =
  | "session"
  | "format"
  | "no_active"
  | "expired"
  | "invalid"
  | "attempts_exceeded";

export type VerifyOtpState = {
  ok?: boolean;
  reason?: VerifyOtpReason;
  attemptsRemaining?: number;
};

const ATTEMPTS_CAP = 5;

const verifyOtpSchema = z.object({
  step: z.enum(["current", "new"]),
  code: z.string(),
});

export async function verifyOtpAction(
  _prev: VerifyOtpState,
  formData: FormData,
): Promise<VerifyOtpState> {
  const session = await getSessionUser();
  if (!session?.id) {
    return { ok: false, reason: "session" };
  }

  const parsed = verifyOtpSchema.safeParse({
    step: formData.get("step"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return { ok: false, reason: "format" };
  }

  const { step, code } = parsed.data;

  if (!isValidOtpFormat(code)) {
    return { ok: false, reason: "format" };
  }

  const admin = createSupabaseAdminClient();

  const { data: row, error: selectError } = await admin
    .from("email_change_otp_codes")
    .select("*")
    .eq("user_id", session.id)
    .eq("step", step)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    console.error(
      `VERIFY_OTP_SELECT_ERROR user=${session.id} step=${step} message=${selectError.message}`,
    );
    return { ok: false, reason: "no_active" };
  }

  if (!row) {
    return { ok: false, reason: "no_active" };
  }

  // Check expiration
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await logAuthEvent({
      eventType: "account_otp_expired",
      userId: session.id,
      metadata: { step },
    });
    return { ok: false, reason: "expired" };
  }

  // Pre-check attempts cap (défensif : si une row à attempts=5 a échappé à
  // la fast-path d'invalidation pour une raison quelconque)
  if (row.attempts >= ATTEMPTS_CAP) {
    await admin
      .from("email_change_otp_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id);
    await logAuthEvent({
      eventType: "account_otp_attempts_exceeded",
      userId: session.id,
      metadata: { step, attempts: row.attempts },
    });
    return { ok: false, reason: "attempts_exceeded" };
  }

  // Verify HMAC constant-time
  const valid = await verifyHash(code, row.code_hash);

  if (!valid) {
    const newAttempts = row.attempts + 1;
    if (newAttempts >= ATTEMPTS_CAP) {
      // Cap atteint sur cette tentative : on incrémente ET on invalide.
      await admin
        .from("email_change_otp_codes")
        .update({
          attempts: newAttempts,
          consumed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      await logAuthEvent({
        eventType: "account_otp_attempts_exceeded",
        userId: session.id,
        metadata: { step, attempts: newAttempts },
      });
      return { ok: false, reason: "attempts_exceeded" };
    }
    await admin
      .from("email_change_otp_codes")
      .update({ attempts: newAttempts })
      .eq("id", row.id);
    await logAuthEvent({
      eventType: "account_otp_invalid",
      userId: session.id,
      metadata: { step, attempts: newAttempts },
    });
    return {
      ok: false,
      reason: "invalid",
      attemptsRemaining: ATTEMPTS_CAP - newAttempts,
    };
  }

  // Valid : consume row
  await admin
    .from("email_change_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);
  await logAuthEvent({
    eventType: "account_otp_verified",
    userId: session.id,
    metadata: { step },
  });
  return { ok: true };
}

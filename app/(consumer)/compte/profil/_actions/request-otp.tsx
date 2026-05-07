"use server";

// =============================================================================
// Server action : requestOtp step=current ou step=new (T-013 PR2 C2.5)
// =============================================================================
// Étape 1 (step=current → OTP envoyé à l'ancienne adresse) ou étape 2
// (step=new → OTP envoyé à la nouvelle adresse) du flow A3 change_email :
//
//   1. Auth via getSessionUser (fail si pas connecté)
//   2. Validation Zod { step, newEmail } — newEmail toujours requis car le
//      template otp-current l'affiche aussi (garde-fou anti-phishing)
//   3. Refuse si newEmail === currentEmail (case-insensitive)
//   4. Rate-limit 3/60s par (userId, step) [Q5 + Q10 PHASE 2.A]
//   5. INVALIDATE rows OTP précédents non consommés pour ce (user, step)
//      (re-request annule l'ancien — un seul OTP actif à la fois par étape)
//   6. Génère OTP 6 chiffres bias-free + HMAC, INSERT row avec
//      expires_at = now + 10 min, ip + user_agent capturés via headers()
//   7. Send Resend template (current → ancienne adresse, new → nouvelle)
//   8. audit_log account_otp_requested avec step + email_target_masked
//
// Anti-pattern proscrit : aucune relation avec supabase.auth.updateUser({email})
// côté applicatif. La mutation auth.users.email arrive seulement en C2.7
// (completeEmailChange) via auth.admin.updateUserById.
// =============================================================================

import { z } from "zod";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import {
  logAuthEvent,
  extractRequestContext,
} from "@/lib/audit-logs/log-auth-event";
import { maskEmail } from "@/lib/rgpd/mask-email";
import { sendTemplate } from "@/lib/resend/send";
import { generateOtp } from "@/lib/email-change/otp";
import { hashOtp } from "@/lib/email-change/hmac";
import { checkOtpRateLimit } from "@/lib/email-change/rate-limit";
import EmailChangeOtpCurrent, {
  subject as currentSubject,
} from "@/lib/resend/templates/email-change-otp-current";
import EmailChangeOtpNew, {
  subject as newSubject,
} from "@/lib/resend/templates/email-change-otp-new";

export type RequestOtpState = {
  ok?: true;
  error?: string;
  retryAfterSeconds?: number;
};

const requestOtpSchema = z.object({
  step: z.enum(["current", "new"]),
  newEmail: z.string().trim().toLowerCase().email("Email invalide"),
});

const OTP_VALIDITY_MINUTES = 10;

export async function requestOtpAction(
  _prev: RequestOtpState,
  formData: FormData,
): Promise<RequestOtpState> {
  const session = await getSessionUser();
  if (!session?.email) {
    return { error: "Session introuvable. Reconnecte-toi." };
  }

  const parsed = requestOtpSchema.safeParse({
    step: formData.get("step"),
    newEmail: formData.get("newEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }

  const { step, newEmail } = parsed.data;
  const currentEmail = session.email.toLowerCase();

  if (newEmail === currentEmail) {
    return { error: "Le nouvel email est identique à l'actuel." };
  }

  const rl = await checkOtpRateLimit(session.id, step);
  if (!rl.ok) {
    return {
      error: `Trop de demandes. Réessayez dans ${rl.retryAfterSeconds}s.`,
      retryAfterSeconds: rl.retryAfterSeconds,
    };
  }

  const admin = createSupabaseAdminClient();

  // INVALIDATE previous unconsumed rows for this (user, step) — re-request
  // kills old. Pas de race avec un verifyOtp concurrent : si verify est en
  // cours il a déjà chargé son row, et notre UPDATE ne touchera plus la
  // row consumed entre-temps (consumed_at is null filter).
  const { error: invalidateError } = await admin
    .from("email_change_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", session.id)
    .eq("step", step)
    .is("consumed_at", null);
  if (invalidateError) {
    console.error(
      `REQUEST_OTP_INVALIDATE_ERROR user=${session.id} step=${step} message=${invalidateError.message}`,
    );
    return { error: "Erreur technique. Réessayez." };
  }

  const code = generateOtp();
  const codeHash = await hashOtp(code);
  const targetEmail = step === "current" ? currentEmail : newEmail;
  const expiresAt = new Date(
    Date.now() + OTP_VALIDITY_MINUTES * 60 * 1000,
  ).toISOString();

  // Capture request context (forensique) — tolérant si headers() inaccessible
  // (test, job background, etc.).
  const { ipAddress, userAgent } = await (async () => {
    try {
      return extractRequestContext(await headers());
    } catch {
      return { ipAddress: null, userAgent: null };
    }
  })();

  const { error: insertError } = await admin
    .from("email_change_otp_codes")
    .insert({
      user_id: session.id,
      step,
      email: targetEmail,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
  if (insertError) {
    console.error(
      `REQUEST_OTP_INSERT_ERROR user=${session.id} step=${step} message=${insertError.message}`,
    );
    return { error: "Erreur technique. Réessayez." };
  }

  const sendResult =
    step === "current"
      ? await sendTemplate({
          to: currentEmail,
          userId: session.id,
          template: "email-change-otp-current",
          subject: currentSubject({ otpCode: code, newEmail }),
          element: <EmailChangeOtpCurrent otpCode={code} newEmail={newEmail} />,
          metadata: { step, target: maskEmail(currentEmail) },
        })
      : await sendTemplate({
          to: newEmail,
          userId: session.id,
          template: "email-change-otp-new",
          subject: newSubject({ otpCode: code }),
          element: <EmailChangeOtpNew otpCode={code} />,
          metadata: { step, target: maskEmail(newEmail) },
        });

  if (!sendResult.ok) {
    return { error: "Impossible d'envoyer le code. Réessayez." };
  }

  await logAuthEvent({
    eventType: "account_otp_requested",
    userId: session.id,
    metadata: {
      step,
      email_target_masked: maskEmail(targetEmail),
    },
  });

  return { ok: true };
}

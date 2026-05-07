"use server";

// =============================================================================
// Server action : completeEmailChange (T-013 PR2 C2.7)
// =============================================================================
// Étape 3 (finale) du flow A3 change_email. Appelée seulement après que les
// 2 verifyOtp (current + new) ont retourné ok=true. Effectue la mutation
// auth.users.email + sync public.users.email + force logout cross-device.
//
//   1. Auth via getSessionUser
//   2. Validation Zod { newEmail }
//   3. Refuse si newEmail === currentEmail (défensif)
//   4. Defensive recheck DB :
//      - latest row step=current : consumed_at NOT NULL
//      - latest row step=new : consumed_at NOT NULL ET email === newEmail
//        (l'user ne peut pas avoir vérifié OTP pour email A puis soumis
//        complete avec email B)
//   5. admin.auth.admin.updateUserById(userId, { email: newEmail })
//      → bypass Secure Email Change toggle ON (filet sécu PR1)
//   6. UPDATE public.users SET email = newEmail
//   7. userClient.auth.signOut({ scope: 'others' })
//      → Q3 PHASE 2.A : invalide les autres devices, garde session courante.
//      Utilise userClient (server client avec cookies/JWT) car l'admin
//      auth-js signOut() nécessite un JWT, pas un userId. GoTrue identifie
//      le device "courant" via la JWT du request (via cookies).
//   8. audit_log account_email_change_completed
//
// Ordre fail-fast : si updateUserById échoue (collision UNIQUE etc.), on
// abort. Si users update échoue, on log + return error (auth ↔ public
// désynchro à investiguer manuellement). Si signOut échoue, on log warn
// et on continue (l'email change a réussi, le force logout est nice-to-have).
// =============================================================================

import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { maskEmail } from "@/lib/rgpd/mask-email";

export type CompleteEmailChangeReason =
  | "session"
  | "format"
  | "same_email"
  | "flow_invalid"
  | "email_collision"
  | "auth_update_failed"
  | "users_update_failed";

export type CompleteEmailChangeState = {
  ok?: boolean;
  reason?: CompleteEmailChangeReason;
};

const schema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Email invalide"),
});

export async function completeEmailChangeAction(
  _prev: CompleteEmailChangeState,
  formData: FormData,
): Promise<CompleteEmailChangeState> {
  const session = await getSessionUser();
  if (!session?.id || !session.email) {
    return { ok: false, reason: "session" };
  }

  const parsed = schema.safeParse({
    newEmail: formData.get("newEmail"),
  });
  if (!parsed.success) {
    return { ok: false, reason: "format" };
  }

  const { newEmail } = parsed.data;
  const currentEmail = session.email.toLowerCase();

  if (newEmail === currentEmail) {
    return { ok: false, reason: "same_email" };
  }

  const admin = createSupabaseAdminClient();

  // Defensive recheck : both step rows must be consumed_at NOT NULL
  const { data: currentRow } = await admin
    .from("email_change_otp_codes")
    .select("consumed_at, email")
    .eq("user_id", session.id)
    .eq("step", "current")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!currentRow || !currentRow.consumed_at) {
    return { ok: false, reason: "flow_invalid" };
  }

  const { data: newRow } = await admin
    .from("email_change_otp_codes")
    .select("consumed_at, email")
    .eq("user_id", session.id)
    .eq("step", "new")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!newRow || !newRow.consumed_at) {
    return { ok: false, reason: "flow_invalid" };
  }

  // Defensive : email match — l'user ne peut pas avoir vérifié OTP pour
  // email A puis soumis completeEmailChange avec email B (cohérence
  // entre verifyOtp.row.email et complete.newEmail param).
  if (newRow.email !== newEmail) {
    return { ok: false, reason: "flow_invalid" };
  }

  // Update auth.users.email (bypass Secure Email Change toggle PR1)
  const { error: authUpdateError } = await admin.auth.admin.updateUserById(
    session.id,
    { email: newEmail },
  );
  if (authUpdateError) {
    console.error(
      `COMPLETE_EMAIL_CHANGE_AUTH_UPDATE_ERROR user=${session.id} message=${authUpdateError.message}`,
    );
    if (
      /already registered|already exists|email_exists|duplicate key/i.test(
        authUpdateError.message,
      )
    ) {
      return { ok: false, reason: "email_collision" };
    }
    return { ok: false, reason: "auth_update_failed" };
  }

  // Sync public.users.email (cohérent flow change-password.ts pattern admin)
  const { error: usersUpdateError } = await admin
    .from("users")
    .update({ email: newEmail })
    .eq("id", session.id);
  if (usersUpdateError) {
    // CRITIQUE : auth.users ↔ public.users désynchro. Trace forensique
    // explicite pour reconciliation manuelle. Le UNIQUE INDEX sur
    // lower(public.users.email) (PR1) pourrait aussi déclencher cette path
    // si race avec un autre user (mais la chance est ~0 vu l'unicité auth).
    console.error(
      `COMPLETE_EMAIL_CHANGE_USERS_UPDATE_ERROR user=${session.id} new_email_masked=${maskEmail(newEmail)} message=${usersUpdateError.message}`,
    );
    return { ok: false, reason: "users_update_failed" };
  }

  // Force logout other devices (Q3 PHASE 2.A : scope 'others'). Utilise
  // userClient (server client avec cookies/JWT) car GoTrue admin signOut
  // requiert un JWT, pas un userId. scope 'others' garde la session
  // courante naturellement (cf. typedoc GoTrueClient.signOut).
  const userClient = await createSupabaseServerClient();
  const { error: signOutError } = await userClient.auth.signOut({
    scope: "others",
  });
  if (signOutError) {
    console.warn(
      `COMPLETE_EMAIL_CHANGE_SIGNOUT_WARN user=${session.id} message=${signOutError.message}`,
    );
  }

  await logAuthEvent({
    eventType: "account_email_change_completed",
    userId: session.id,
    metadata: {
      old_email_masked: maskEmail(currentEmail),
      new_email_masked: maskEmail(newEmail),
    },
  });

  return { ok: true };
}

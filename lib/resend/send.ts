import type { ReactElement } from "react";
import { render } from "@react-email/render";
import { resend, resendFromEmail } from "./client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maskEmail } from "@/lib/rgpd/mask-email";
import { canSendTo } from "@/lib/resend/suppressions";

interface SendTemplateArgs {
  to: string;
  userId: string | null;
  template: string;
  subject: string;
  element: ReactElement;
  metadata?: Record<string, unknown>;
}

export async function renderEmail(element: ReactElement): Promise<string> {
  return render(element);
}

// `skipped` distingue le court-circuit pre-send (canSendTo=false) de
// l'échec applicatif (render fail, Resend 5xx). Garde le champ `error`
// sur tous les paths !ok pour rester rétro-compat avec les callers qui
// discriminent uniquement via `if (!result.ok) { logger(result.error) }`
// (cf lib/stock-alerts/notify-back-in-stock.tsx, app/api/admin/producers/
// invite/route.tsx). Les callers qui veulent traiter skipped ≠ failed
// peuvent gater sur `result.skipped === true`.
export type SendTemplateResult =
  | { ok: true; id: string }
  | { ok: false; error: string; skipped?: true };

// Envoie un email via Resend et log l'envoi dans public.notifications.
// Ne throw pas : renvoie un statut pour que l'appelant puisse continuer
// à traiter les autres destinataires. Tout échec produit un log Vercel
// grep-able via [EMAIL_SEND_FAIL].
//
// Audit Email H-3 + M-5 (2026-05-05) : pre-send check via canSendTo().
// Si l'email destinataire est dans email_suppressions avec une reason
// blocking (hard_bounce / complained / soft_bounce_threshold / manual),
// on court-circuite resend.emails.send + on INSERT notifications
// statut='skipped' metadata.skip_reason='suppressed' pour traçabilité.
// Pas de masking côté metadata.email (cf lib/rgpd/mask-email — clear OK
// en DB, masqué uniquement en logs Vercel).
export async function sendTemplate({
  to,
  userId,
  template,
  subject,
  element,
  metadata = {},
}: SendTemplateArgs): Promise<SendTemplateResult> {
  const admin = createSupabaseAdminClient();

  // Pre-send check suppression list (H-3 + M-5).
  const allowed = await canSendTo(to);
  if (!allowed) {
    console.log(
      `[EMAIL_SEND_SKIP] template=${template} to=${maskEmail(to)} reason=suppressed`,
    );
    await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "skipped",
      metadata: { ...metadata, skip_reason: "suppressed", email: to },
    });
    return { ok: false, skipped: true, error: "suppressed" };
  }

  let html: string;
  try {
    html = await renderEmail(element);
  } catch (err) {
    const error = err as Error;
    const reason = `render_failed: ${error.message}`;
    console.error(
      `[EMAIL_SEND_FAIL] template=${template} to=${maskEmail(to)} error_name=${error.name} error_message=${error.message}`,
    );
    await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "failed",
      metadata: { ...metadata, error: reason },
    });
    return { ok: false, error: reason };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: resendFromEmail,
      to,
      subject,
      html,
    });

    if (error || !data) {
      const message = error?.message ?? "unknown";
      console.error(
        `[EMAIL_SEND_FAIL] template=${template} to=${maskEmail(to)} error_name=${error?.name ?? "unknown"} error_message=${message}`,
      );
      await admin.from("notifications").insert({
        user_id: userId,
        type: "email",
        template,
        statut: "failed",
        metadata: { ...metadata, error: message },
      });
      return { ok: false, error: message };
    }

    await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "sent",
      metadata: { ...metadata, resend_id: data.id },
    });
    return { ok: true, id: data.id };
  } catch (err) {
    const error = err as Error;
    console.error(
      `[EMAIL_SEND_FAIL] template=${template} to=${maskEmail(to)} error_name=${error.name} error_message=${error.message}`,
    );
    await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "failed",
      metadata: { ...metadata, error: error.message },
    });
    return { ok: false, error: error.message };
  }
}

export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

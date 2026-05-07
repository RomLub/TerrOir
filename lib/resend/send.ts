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

// Flag e2e capture : court-circuite resend.emails.send() et écrit l'email
// dans test_emails_captured pour assertions Playwright sans consommer le
// quota Resend (3000/mois).
//
// Gate STRICT NODE_ENV !== 'production' pour rendre toute activation
// accidentelle en prod impossible : même si RESEND_TEST_MODE=true se
// retrouve dans Vercel prod env (humain ou CI mal configuré), le flag est
// ignoré dès lors que NODE_ENV='production'. NODE_ENV est posé par Next.js
// build (non override-able trivialement côté Vercel).
//
// Conservé : pre-send canSendTo (suppressions) et render HTML — parité
// fonctionnelle avec le path normal pour ne pas masquer un bug. Seule la
// transmission Resend est remplacée par INSERT test_emails_captured.
function isE2ETestCaptureMode(): boolean {
  return (
    process.env.RESEND_TEST_MODE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

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
    const { error: notifErr } = await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "skipped",
      metadata: { ...metadata, skip_reason: "suppressed", email: to },
    });
    if (notifErr) {
      console.error(
        `[NOTIF_INSERT_ERR] template=${template} statut=skipped error=${notifErr.message}`,
      );
    }
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
    const { error: notifErr } = await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "failed",
      metadata: { ...metadata, error: reason },
    });
    if (notifErr) {
      console.error(
        `[NOTIF_INSERT_ERR] template=${template} statut=failed error=${notifErr.message}`,
      );
    }
    return { ok: false, error: reason };
  }

  // E2E capture mode (gated NODE_ENV !== 'production'). On INSERT le mail
  // dans test_emails_captured + on garde la parité notifications statut=sent
  // (les tests qui assert sur notifications doivent voir la même row qu'en
  // path normal, à part metadata.captured_id vs metadata.resend_id).
  if (isE2ETestCaptureMode()) {
    const { data: capture, error: captureErr } = await admin
      .from("test_emails_captured")
      .insert({
        to_email: to,
        from_email: resendFromEmail,
        subject,
        template,
        html,
        metadata: { ...metadata, e2e_capture: true },
        user_id: userId,
      })
      .select("id")
      .single();

    if (captureErr || !capture) {
      const reason = captureErr?.message ?? "test_emails_captured insert returned no row";
      console.error(
        `[EMAIL_TEST_CAPTURE_FAIL] template=${template} to=${maskEmail(to)} error=${reason}`,
      );
      const { error: notifErr } = await admin.from("notifications").insert({
        user_id: userId,
        type: "email",
        template,
        statut: "failed",
        metadata: { ...metadata, error: reason, e2e_capture: true },
      });
      if (notifErr) {
        console.error(
          `[NOTIF_INSERT_ERR] template=${template} statut=failed error=${notifErr.message}`,
        );
      }
      return { ok: false, error: reason };
    }

    const { error: notifErr } = await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "sent",
      metadata: { ...metadata, captured_id: capture.id, e2e_capture: true },
    });
    if (notifErr) {
      console.error(
        `[NOTIF_INSERT_ERR] template=${template} statut=sent error=${notifErr.message}`,
      );
    }
    console.log(
      `[EMAIL_TEST_CAPTURE] template=${template} to=${maskEmail(to)} captured_id=${capture.id}`,
    );
    return { ok: true, id: capture.id };
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
      const { error: notifErr } = await admin.from("notifications").insert({
        user_id: userId,
        type: "email",
        template,
        statut: "failed",
        metadata: { ...metadata, error: message },
      });
      if (notifErr) {
        console.error(
          `[NOTIF_INSERT_ERR] template=${template} statut=failed error=${notifErr.message}`,
        );
      }
      return { ok: false, error: message };
    }

    const { error: notifErr } = await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "sent",
      metadata: { ...metadata, resend_id: data.id },
    });
    if (notifErr) {
      console.error(
        `[NOTIF_INSERT_ERR] template=${template} statut=sent error=${notifErr.message}`,
      );
    }
    return { ok: true, id: data.id };
  } catch (err) {
    const error = err as Error;
    console.error(
      `[EMAIL_SEND_FAIL] template=${template} to=${maskEmail(to)} error_name=${error.name} error_message=${error.message}`,
    );
    const { error: notifErr } = await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "failed",
      metadata: { ...metadata, error: error.message },
    });
    if (notifErr) {
      console.error(
        `[NOTIF_INSERT_ERR] template=${template} statut=failed error=${notifErr.message}`,
      );
    }
    return { ok: false, error: error.message };
  }
}

export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

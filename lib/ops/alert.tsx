import "server-only";
import * as Sentry from "@sentry/nextjs";
import { OPS_EMAIL } from "@/lib/env/ops-email";
import { sendTemplate } from "@/lib/resend/send";
import AdminOpsAlert, {
  subject as opsAlertSubject,
} from "@/lib/resend/templates/admin-ops-alert";

// Cluster B Phase 3 (bugs-P1-3) — helper d'alerting ops critique.
//
// Pose un signal duplique (Sentry + email Resend) sur les 5 prefixes critiques
// drift Stripe/DB. Pattern fail-safe : ne throw JAMAIS. Une exception dans le
// helper ferait casser un path metier qui s'execute deja en mode degrade.
//
// Liste des prefixes consommateurs :
//   - [REFUND_DB_DRIFT]                  (cancel + cron timeout + refund manual)
//   - [STRIPE_WEBHOOK_BG_ERR]            (webhook background errs Resend/Twilio)
//   - [REFUND_TRANSITION_DRIFT]          (cron timeout — refund emis transition refusee)
//   - [STRIPE_CHARGE_REFUNDED_NO_ORDER]  (webhook charge.refunded orphan)
//   - [WEBHOOK_SUCCEEDED_REFUND_FAILED]  (revival refund Stripe failed)
//
// Doctrine anti-PII (T-200 r1 + T-249) — voir aussi sentry.*.config.ts beforeSend :
//   - Strip systematique cote helper : email, phone, latitude, longitude,
//     code_postal, consumer_id, payment_intent_id (defense-in-depth, le hook
//     Sentry beforeSend re-strip de toute facon).
//   - producer_id reste autorise (signal diagnostic ops backend pure).
//
// Format email :
//   - Sujet : `[OPS] {prefix} {summary}`
//   - Body  : prefix, error_message, order_id, timestamp, stack truncee (2000 chars).
//
// Logs locaux :
//   - [OPS_ALERT_SENT]    : envoi OK (Sentry + email).
//   - [OPS_ALERT_FAIL]    : echec helper interne (swallow + warn).

export type OpsAlertPrefix =
  | "[REFUND_DB_DRIFT]"
  | "[STRIPE_WEBHOOK_BG_ERR]"
  | "[REFUND_TRANSITION_DRIFT]"
  | "[STRIPE_CHARGE_REFUNDED_NO_ORDER]"
  | "[WEBHOOK_SUCCEEDED_REFUND_FAILED]";

export type OpsAlertMetadata = Record<string, unknown>;

// Cles PII strippees du metadata avant Sentry + email body. Defense-in-depth :
// le hook beforeSend Sentry re-strip aussi. La liste est volontairement large.
const PII_KEYS_TO_STRIP = new Set<string>([
  "email",
  "phone",
  "telephone",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "code_postal",
  "cp",
  "consumer_id",
  "consumer_name",
  "consumer_email",
  "payment_intent_id",
  "address",
  "adresse",
]);

function stripPii(metadata: OpsAlertMetadata): OpsAlertMetadata {
  const out: OpsAlertMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (PII_KEYS_TO_STRIP.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function truncateStack(err: unknown, max = 2000): string {
  const stack = (err as Error)?.stack ?? String(err);
  return stack.length > max ? stack.slice(0, max) + "...[truncated]" : stack;
}

/**
 * Envoi alerte ops sur Sentry + email Resend en parallele.
 *
 * Fail-safe : ne throw JAMAIS. Toute exception est swallow + log local
 * `[OPS_ALERT_FAIL]`. Le caller continue son flow.
 */
export async function sendOpsAlert(
  prefix: OpsAlertPrefix,
  error: unknown,
  metadata: OpsAlertMetadata = {},
): Promise<void> {
  try {
    const sanitized = stripPii(metadata);
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error);

    const orderId =
      typeof sanitized.order_id === "string" ? sanitized.order_id : null;
    const summary = orderId ? `order=${orderId}` : errorMessage.slice(0, 80);

    // 1. Sentry (best-effort, ne throw pas).
    try {
      Sentry.captureException(error instanceof Error ? error : new Error(errorMessage), {
        tags: {
          ops_prefix: prefix,
          ...(orderId ? { order_id: orderId } : {}),
        },
        extra: sanitized,
      });
    } catch (sentryErr) {
      console.warn(
        `[OPS_ALERT_FAIL] sentry capture error: ${(sentryErr as Error).message}`,
      );
    }

    // 2. Email Resend en parallele.
    const props = {
      prefix,
      summary,
      errorMessage,
      orderId,
      timestamp: new Date().toISOString(),
      stack: truncateStack(error),
      metadata: sanitized,
    };

    await sendTemplate({
      to: OPS_EMAIL,
      userId: null,
      template: "admin_ops_alert",
      subject: opsAlertSubject(props),
      element: <AdminOpsAlert {...props} />,
      metadata: {
        ops_prefix: prefix,
        ...(orderId ? { order_id: orderId } : {}),
      },
    }).catch((err) => {
      console.warn(
        `[OPS_ALERT_FAIL] email send error prefix=${prefix} : ${(err as Error).message}`,
      );
    });

    console.log(
      `[OPS_ALERT_SENT] prefix=${prefix} ${orderId ? `order=${orderId}` : ""}`,
    );
  } catch (helperErr) {
    console.warn(
      `[OPS_ALERT_FAIL] helper exception prefix=${prefix} : ${(helperErr as Error).message}`,
    );
  }
}

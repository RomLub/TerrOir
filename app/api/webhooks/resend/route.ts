import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkOrMarkProcessed } from "@/lib/webhook-events/check-or-mark-processed";
import { logPaymentEvent } from "@/lib/audit-logs/log-payment-event";
import {
  addSuppression,
  incrementSoftBounce,
} from "@/lib/resend/suppressions";
import {
  readSvixHeaders,
  verifySvixSignature,
} from "@/lib/resend/verify-svix";
import { maskEmail } from "@/lib/rgpd/mask-email";

// Audit Email H-3 (2026-05-05) — webhook Resend entrant.
//
// Référence : docs/audits/audit-email-deliverability-2026-05-05.md (H-3 + M-5).
// Fix doc   : docs/fixes/fix-email-h3-m5-webhook-resend-2026-05-05.md.
// Migration : 20260505600000_audit_email_h3_m5_email_suppressions.sql.
//
// Sources event Resend : https://resend.com/docs/dashboard/webhooks/event-types
// Signature Svix       : lib/resend/verify-svix.ts (HMAC-SHA256 manuel).
// Dédup applicative    : lib/webhook-events/check-or-mark-processed.ts
//                        (table webhook_events_processed, namespace
//                        `resend_${svixId}` pour ne pas collisionner avec
//                        Stripe `evt_xxx`).
//
// Routing événements (Annexe B audit) :
//   - email.delivered          → UPDATE notifications.metadata.delivered_at
//   - email.bounced (Permanent)→ addSuppression hard_bounce + audit log
//   - email.bounced (Transient)→ incrementSoftBounce (suppress après 3)
//   - email.bounced (autre)    → addSuppression hard_bounce (safety net :
//                                Undetermined / Unknown traités comme dur)
//   - email.complained         → addSuppression complained + audit log
//                                (légal CASL : trace formelle plainte spam)
//   - email.delivery_delayed   → UPDATE notifications.metadata.delayed_at
//   - email.sent / opened / clicked → no-op (engagement tracking pas
//                                       critique pour transactional V1)
//
// Ack 200 dans tous les cas après dédup : Resend retry en 5xx → on évite
// les loops si un cas inattendu arrive (event_type inconnu, payload mal
// formé, etc.). Les erreurs catch sont loggées pour Vercel, pas remontées
// en 500. Exception : signature invalide → 401 (sécurité), erreur DB sur
// dédup → 500 (Resend retry est OK car la dédup PK protège).

interface ResendBouncePayload {
  type?: string; // 'Permanent' | 'Transient' | 'Undetermined' | autres
  message?: string;
  subType?: string;
}

interface ResendEventData {
  email_id?: string;
  to?: string[] | string;
  created_at?: string;
  bounce?: ResendBouncePayload;
  delayedUntil?: string;
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: ResendEventData;
}

// Helper UPDATE notifications.metadata via fetch+merge JS-side. Pas de
// jsonb_set côté SDK Supabase sans RPC dédié — l'overhead d'une RPC pour
// 2 events nice-to-have (delivered_at, delayed_at) n'est pas justifié.
// Race condition théorique si email.delivered et email.delivery_delayed
// arrivent en parallèle (last-write-wins sur les autres clés metadata) :
// dans la pratique, delayed_at précède toujours delivered_at de plusieurs
// secondes côté Resend, et delivered_at est write-once.
//
async function mergeNotificationMetadata(
  admin: SupabaseClient,
  resendId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data: rows, error: readErr } = await admin
    .from("notifications")
    .select("id, metadata")
    .filter("metadata->>resend_id", "eq", resendId)
    .limit(1);
  if (readErr || !rows || rows.length === 0) {
    if (readErr) {
      console.warn(
        `[RESEND_WEBHOOK_NOTIFS_READ_WARN] resend_id=${resendId} error=${readErr.message}`,
      );
    }
    return;
  }
  const row = rows[0] as { id: string; metadata: Record<string, unknown> | null };
  const merged = { ...(row.metadata ?? {}), ...patch };
  const { error: updErr } = await admin
    .from("notifications")
    .update({ metadata: merged })
    .eq("id", row.id);
  if (updErr) {
    console.warn(
      `[RESEND_WEBHOOK_NOTIFS_UPDATE_WARN] resend_id=${resendId} error=${updErr.message}`,
    );
  }
}

function extractFirstRecipient(data: ResendEventData | undefined): string | null {
  if (!data) return null;
  const to = data.to;
  if (Array.isArray(to)) return to[0] ?? null;
  if (typeof to === "string") return to || null;
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Fail-fast cohérent avec lib/resend/client.ts (RESEND_API_KEY/FROM_EMAIL
    // throw au module-load). Ici on log et 500 pour ne pas leak l'absence
    // au caller (qui est Resend, donc pas critique, mais cohérence).
    console.error(
      "[RESEND_WEBHOOK_CONFIG_ERR] missing RESEND_WEBHOOK_SECRET env var",
    );
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const headers = readSvixHeaders(request.headers);
  if (!headers) {
    console.warn("[RESEND_WEBHOOK_INVALID_SIG] reason=missing_headers");
    return NextResponse.json({ error: "Missing svix headers" }, { status: 401 });
  }

  const rawBody = await request.text();

  const verification = verifySvixSignature(rawBody, headers, secret);
  if (!verification.ok) {
    console.warn(
      `[RESEND_WEBHOOK_INVALID_SIG] svix_id=${headers.id} reason=${verification.reason}`,
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch (err) {
    console.warn(
      `[RESEND_WEBHOOK_PARSE_ERR] svix_id=${headers.id} error=${(err as Error).message}`,
    );
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.type ?? "unknown";
  const dedupKey = `resend_${headers.id}`;
  const admin = createSupabaseAdminClient();

  // Dédup applicative : Resend / Svix retentent en cas de 5xx ou network
  // glitch. Sans dédup, un event email.complained pourrait poser 2x le
  // suppression UPSERT (idempotent côté DB) MAIS aussi 2x le audit log
  // (pas idempotent — INSERT-only). Pattern identique au webhook Stripe.
  try {
    const { alreadyProcessed } = await checkOrMarkProcessed(
      admin,
      dedupKey,
      `resend_${eventType}`,
    );
    if (alreadyProcessed) {
      return NextResponse.json({ received: true, deduped: true });
    }
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  const recipient = extractFirstRecipient(event.data);
  const emailId = event.data?.email_id ?? null;

  try {
    switch (eventType) {
      case "email.delivered": {
        // Trace delivery réelle (vs juste le 200 du POST Resend). UPDATE
        // notifications.metadata.delivered_at en match metadata->>'resend_id'.
        // Décision Lot 2 audit : pas de migration delivered_at — on étend
        // jsonb metadata. Fetch+merge JS-side (pas de jsonb_set côté SDK
        // sans RPC) ; race acceptable car delivered_at est write-once.
        if (!emailId) break;
        const deliveredAt = event.data?.created_at ?? event.created_at ?? null;
        await mergeNotificationMetadata(admin, emailId, {
          delivered_at: deliveredAt,
        });
        break;
      }

      case "email.bounced": {
        if (!recipient) break;
        const bounceType = event.data?.bounce?.type ?? "Undetermined";
        if (bounceType === "Transient") {
          await incrementSoftBounce(recipient, emailId);
        } else {
          // Permanent + Undetermined + tout type inconnu : safety net hard.
          await addSuppression(recipient, "hard_bounce", emailId);
          // F-053 (audit pré-launch 2026-05-11) : doctrine T-200 r1 — pas de
          // PII verbatim dans audit_logs.metadata pour les events purement
          // opérationnels. `email_suppressions` séparée garde la clé email en
          // clair (nécessaire au lookup pré-envoi sendTemplate), donc on
          // n'enlève pas le signal forensique : on déduit l'event audit en
          // matchant `source_resend_id` côté notifications. Pour
          // `email_complaint_received` ci-dessous, la doctrine légale CASL
          // justifie la trace email verbatim (acte juridique = plainte spam).
          await logPaymentEvent({
            eventType: "email_hard_bounce_suppressed",
            metadata: {
              email_masked: maskEmail(recipient),
              source_resend_id: emailId,
              bounce_type: bounceType,
              bounce_subtype: event.data?.bounce?.subType ?? null,
              svix_id: headers.id,
            },
          });
        }
        break;
      }

      case "email.complained": {
        if (!recipient) break;
        // Suppression IMMÉDIATE + audit log légal (CASL/RGPD) — la plainte
        // spam est un acte juridique, on conserve la trace formelle.
        await addSuppression(recipient, "complained", emailId);
        await logPaymentEvent({
          eventType: "email_complaint_received",
          metadata: {
            email: recipient,
            source_resend_id: emailId,
            svix_id: headers.id,
          },
        });
        break;
      }

      case "email.delivery_delayed": {
        if (!emailId) break;
        const delayedAt = event.created_at ?? new Date().toISOString();
        await mergeNotificationMetadata(admin, emailId, {
          delayed_at: delayedAt,
        });
        break;
      }

      // V1 : engagement tracking (sent/opened/clicked) non instrumenté.
      // sent : redondant (notifications.statut='sent' déjà posé au POST
      //        Resend dans sendTemplate, valeur indicative).
      // opened/clicked : pas critique pour les transactionnels (privacy
      //                  ambigu vs RGPD si on veut tracker).
      case "email.sent":
      case "email.opened":
      case "email.clicked":
        break;

      default:
        // Event_type inconnu → log info pour audit futur, no-op fonctionnel.
        // Resend peut introduire de nouveaux types ; mieux vaut ack 200 et
        // logger que 500 + retry loop indéfini.
        console.log(
          `[RESEND_WEBHOOK_UNHANDLED] event_type=${eventType} svix_id=${headers.id}`,
        );
        break;
    }
  } catch (err) {
    // Erreur applicative handler (suppression upsert qui throw,
    // logPaymentEvent qui swallow, etc.). Log + 500 pour Resend retry.
    // La dédup empêchera le double-effet sur retry réussi.
    const recipientMasked = recipient ? maskEmail(recipient) : "(none)";
    console.error(
      `[RESEND_WEBHOOK_HANDLER_ERR] svix_id=${headers.id} event=${eventType} recipient=${recipientMasked} error=${(err as Error).message}`,
    );
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

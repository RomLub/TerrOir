import "server-only";
import { twilioClient } from "./client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface SendSmsArgs {
  to: string;
  userId: string | null;
  template: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export async function sendSms({
  to,
  userId,
  template,
  body,
  metadata = {},
}: SendSmsArgs): Promise<
  { ok: true; sid: string } | { ok: false; error: string }
> {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    return { ok: false, error: "TWILIO_PHONE_NUMBER not configured" };
  }

  const admin = createSupabaseAdminClient();

  try {
    const message = await twilioClient.messages.create({ body, from, to });
    await admin.from("notifications").insert({
      user_id: userId,
      type: "sms",
      template,
      statut: "sent",
      metadata: { ...metadata, twilio_sid: message.sid },
    });
    return { ok: true, sid: message.sid };
  } catch (err) {
    const msg = (err as Error).message;
    await admin.from("notifications").insert({
      user_id: userId,
      type: "sms",
      template,
      statut: "failed",
      metadata: { ...metadata, error: msg },
    });
    return { ok: false, error: msg };
  }
}

// =============================================================================
// SMS #1 — Rappel consommateur le jour du retrait, 8h.
// À n'envoyer QUE si users.sms_optin = true et telephone présent.
// =============================================================================
export async function sendReminderSms(args: {
  to: string;
  userId: string;
  codeCommande: string;
  heureRetrait: string;
  exploitation: string;
  mapsUrl: string;
}) {
  const body =
    `TerrOir : Rappel retrait aujourd'hui ${args.heureRetrait} ` +
    `chez ${args.exploitation}. Code : ${args.codeCommande}. ` +
    `Itinéraire : ${args.mapsUrl}`;
  return sendSms({
    to: args.to,
    userId: args.userId,
    template: "sms_reminder_consumer",
    body,
    metadata: { code_commande: args.codeCommande },
  });
}

// =============================================================================
// SMS #2 — Nouvelle commande producteur (backup systématique de l'email).
// =============================================================================
export async function sendNewOrderProducerSms(args: {
  to: string;
  userId: string;
  customerPrenom: string;
  dateRetrait: string;
}) {
  const body =
    `TerrOir : Nouvelle commande de ${args.customerPrenom} pour ${args.dateRetrait}. ` +
    `Connectez-vous pour confirmer sous 24h : pro.terroir-local.fr`;
  return sendSms({
    to: args.to,
    userId: args.userId,
    template: "sms_new_order_producer",
    body,
    metadata: { customer_prenom: args.customerPrenom },
  });
}

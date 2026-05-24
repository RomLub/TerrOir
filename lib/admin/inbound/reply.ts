import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resend } from "@/lib/resend/client";
import { logInboundEmailEvent } from "@/lib/audit-logs/log-inbound-email-event";

// Chantier 9 — réponse à un email entrant. Envoi via Resend DEPUIS l'adresse
// de contact (interlocuteur unique), avec headers In-Reply-To / References
// pour le threading. Marque replied_at + audit.

// Adresse publique « interlocuteur unique » : les réponses partent TOUJOURS de
// contact@ (jamais de la boîte réellement pollée, admin@, qui est la boîte
// perso de l'admin). Resend envoie depuis n'importe quelle adresse
// @terroir-local.fr (domaine racine vérifié).
const PUBLIC_REPLY_FROM = "contact@terroir-local.fr";

export type ReplyResult = { ok: true } | { ok: false; error: string };

export async function sendInboundReply(
  admin: SupabaseClient,
  actorId: string,
  inboundEmailId: string,
  subject: string,
  body: string,
): Promise<ReplyResult> {
  if (!subject.trim() || !body.trim()) {
    return { ok: false, error: "Sujet et message requis." };
  }

  const { data: row, error: loadErr } = await admin
    .from("inbound_emails")
    .select("id, from_email, message_id, account_id")
    .eq("id", inboundEmailId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: "Erreur de chargement." };
  if (!row) return { ok: false, error: "Email introuvable." };

  const r = row as {
    id: string;
    from_email: string;
    message_id: string;
    account_id: string | null;
  };

  try {
    const { error } = await resend.emails.send({
      from: PUBLIC_REPLY_FROM,
      to: r.from_email,
      subject,
      text: body,
      // Threading : rattache la réponse au fil du mail entrant.
      headers: r.message_id
        ? { "In-Reply-To": r.message_id, References: r.message_id }
        : undefined,
    });
    if (error) {
      console.error(`[INBOUND_REPLY_SEND_ERR] ${error.message}`);
      return { ok: false, error: `Échec d'envoi : ${error.message}` };
    }
  } catch (err) {
    console.error(`[INBOUND_REPLY_SEND_ERR] ${(err as Error).message}`);
    return { ok: false, error: `Échec d'envoi : ${(err as Error).message}` };
  }

  await admin
    .from("inbound_emails")
    .update({ replied_at: new Date().toISOString() })
    .eq("id", inboundEmailId);

  await logInboundEmailEvent({
    eventType: "inbound_email_replied",
    userId: actorId,
    metadata: { inbound_email_id: inboundEmailId, to: r.from_email },
  });

  return { ok: true };
}

import type { ReactElement } from "react";
import { render } from "@react-email/render";
import { resend } from "./client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

// Envoie un email via Resend et log l'envoi dans public.notifications.
// Ne throw pas : renvoie un statut pour que l'appelant puisse continuer
// à traiter les autres destinataires.
export async function sendTemplate({
  to,
  userId,
  template,
  subject,
  element,
  metadata = {},
}: SendTemplateArgs): Promise<
  { ok: true; id: string } | { ok: false; error: string }
> {
  const html = await renderEmail(element);
  const from = process.env.RESEND_FROM_EMAIL ?? "no-reply@terroir.fr";
  const admin = createSupabaseAdminClient();

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
    });

    if (error || !data) {
      await admin.from("notifications").insert({
        user_id: userId,
        type: "email",
        template,
        statut: "failed",
        metadata: { ...metadata, error: error?.message ?? "unknown" },
      });
      return { ok: false, error: error?.message ?? "unknown" };
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
    const message = (err as Error).message;
    await admin.from("notifications").insert({
      user_id: userId,
      type: "email",
      template,
      statut: "failed",
      metadata: { ...metadata, error: message },
    });
    return { ok: false, error: message };
  }
}

export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

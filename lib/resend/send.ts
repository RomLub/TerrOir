import type { ReactElement } from "react";
import { render } from "@react-email/render";
import { resend, resendFromEmail } from "./client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maskEmail } from "@/lib/rgpd/mask-email";

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
// à traiter les autres destinataires. Tout échec produit un log Vercel
// grep-able via [EMAIL_SEND_FAIL].
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
  const admin = createSupabaseAdminClient();

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

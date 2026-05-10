'use server';

import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { escapeIlikeEmail } from '@/lib/supabase/escape-ilike';
import { generateOptOutToken } from '@/lib/rgpd/opt-out-token';
import { sendTemplate } from '@/lib/resend/send';
import OptOutLink, {
  subject as optOutSubject,
} from '@/lib/resend/templates/opt-out-link';
import { NEXT_PUBLIC_APP_URL } from '@/lib/env/urls';

// Réponse unique (enumeration-resistant) : quel que soit le résultat
// réel (email dans la base ou non, échec Resend), on renvoie le même
// message générique pour ne pas révéler la présence d'un lead.

const GENERIC_MESSAGE =
  "Si cet email correspond à un lead dans notre base, un email vient d'être envoyé avec le lien de désabonnement.";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

type Result =
  | { success: true; message: string }
  | { success: false; error: string };

export async function requestNewOptOutLinkAction(
  formData: FormData,
): Promise<Result> {
  const parsed = schema.safeParse({
    email: String(formData.get('email') ?? ''),
  });
  if (!parsed.success) {
    return { success: false, error: 'Email invalide.' };
  }
  const { email } = parsed.data;

  const admin = createSupabaseAdminClient();
  const { data: lead } = await admin
    .from('producer_interests')
    .select('email')
    .ilike('email', escapeIlikeEmail(email))
    .maybeSingle();

  if (lead) {
    // F-027 : generateOptOutToken retourne maintenant { token, expiresAt }.
    // Le token embarque TTL 30j ; aucun storage DB côté serveur.
    const { token: optOutToken } = generateOptOutToken(email);
    const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/desabonnement?email=${encodeURIComponent(
      email,
    )}&token=${optOutToken}`;

    await sendTemplate({
      to: email,
      userId: null,
      template: 'opt_out_link',
      subject: optOutSubject(),
      element: <OptOutLink unsubscribeUrl={unsubscribeUrl} />,
      metadata: { email },
    });
  }

  return { success: true, message: GENERIC_MESSAGE };
}

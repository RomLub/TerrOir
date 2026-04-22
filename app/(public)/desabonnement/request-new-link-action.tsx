'use server';

import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { generateOptOutToken } from '@/lib/rgpd/opt-out-token';
import { sendTemplate } from '@/lib/resend/send';
import OptOutLink, {
  subject as optOutSubject,
} from '@/lib/resend/templates/opt-out-link';

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
    .eq('email', email)
    .maybeSingle();

  if (lead) {
    const publicBase =
      process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const unsubscribeUrl = `${publicBase}/desabonnement?email=${encodeURIComponent(
      email,
    )}&token=${generateOptOutToken(email)}`;

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

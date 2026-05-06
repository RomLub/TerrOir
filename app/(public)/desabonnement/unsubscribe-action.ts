'use server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { escapeIlikeEmail } from '@/lib/supabase/escape-ilike';
import { verifyOptOutToken } from '@/lib/rgpd/opt-out-token';

type Result = { success: true } | { success: false; error: string };

export async function unsubscribeAction(formData: FormData): Promise<Result> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const token = String(formData.get('token') ?? '').trim();

  if (!email || !token) {
    return { success: false, error: 'Paramètres manquants.' };
  }
  if (!verifyOptOutToken(email, token)) {
    return { success: false, error: 'Lien invalide ou expiré.' };
  }

  // Hard delete toutes les lignes matching email (un même producteur peut
  // avoir plusieurs entrées : formulaire public + invitation admin).
  // RLS producer_interests = admin-only update/select → service_role bypass.
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('producer_interests')
    .delete()
    .ilike('email', escapeIlikeEmail(email));

  if (error) {
    return { success: false, error: 'Erreur technique. Merci de réessayer.' };
  }

  return { success: true };
}

'use server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { escapeIlikeEmail } from '@/lib/supabase/escape-ilike';
import { verifyOptOutToken } from '@/lib/rgpd/opt-out-token';
import { logAuthEvent } from '@/lib/audit-logs/log-auth-event';
import { maskEmail } from '@/lib/rgpd/mask-email';

type Result = { success: true } | { success: false; error: string };

export async function unsubscribeAction(formData: FormData): Promise<Result> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const token = String(formData.get('token') ?? '').trim();

  if (!email || !token) {
    return { success: false, error: 'Paramètres manquants.' };
  }

  // F-027 (audit pré-launch 2026-05-10) : verifyOptOutToken retourne
  // maintenant { valid, expired? } — on distingue le message UX entre
  // "invalide" et "expiré" (le lead peut redemander un nouveau lien via
  // /desabonnement sans token).
  const verification = verifyOptOutToken(email, token);
  if (!verification.valid) {
    return {
      success: false,
      error: verification.expired
        ? 'Lien expiré. Demande un nouveau lien ci-dessous.'
        : 'Lien invalide.',
    };
  }

  // Hard delete toutes les lignes matching email (un même producteur peut
  // avoir plusieurs entrées : formulaire public + invitation admin).
  // RLS producer_interests = admin-only update/select → service_role bypass.
  const admin = createSupabaseAdminClient();
  const { data: deleted, error } = await admin
    .from('producer_interests')
    .delete()
    .ilike('email', escapeIlikeEmail(email))
    .select('id');

  if (error) {
    return { success: false, error: 'Erreur technique. Merci de réessayer.' };
  }

  // F-027 — Audit log forensique. userId = null (lead pas authentifié),
  // email_masked + rows_deleted + token_expires_at pour traçabilité CNIL
  // ("prouvez que la demande de suppression a bien été exécutée").
  await logAuthEvent({
    eventType: 'opt_out_unsubscribed',
    userId: null,
    metadata: {
      email_masked: maskEmail(email),
      rows_deleted: deleted?.length ?? 0,
      token_expires_at: verification.expiresAt.toISOString(),
    },
  });

  return { success: true };
}

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// T-085 — Stats de conversion invitation producteur → onboarding complet.
// Page dashboard `/admin/audit-logs/stats`. Exploite les events
// `admin_invite_*` (T-081) + `invitation_consumed_success` (T-310).
//
// Métriques exposées (fenêtre 30 jours glissants par défaut) :
//   - invitationsSent : count `admin_invite_sent` (1ère envoi, exclut
//     `admin_invite_draft_resend` qui sont des relances de drafts).
//   - onboardingsCompleted : count `invitation_consumed_success` (UPDATE
//     producer_invitations.used_at = succès final = onboarding terminé).
//   - conversionRate : ratio onboardingsCompleted / invitationsSent en %
//     (null si invitationsSent = 0 pour éviter division par zéro).
//
// Lecture via service_role : bypass RLS pour count() agrégé. Au call site
// on est déjà sous le check session.isAdmin du layout (admin) — pas de
// leak de droits.
//
// Limites volontaires :
//   - Pas de cohorte stricte (un onboarding complété aujourd'hui peut être
//     issu d'une invitation envoyée il y a 60 jours). Pour les volumes
//     pré-Live (quelques dizaines d'invitations / mois), c'est acceptable.
//     Quand le funnel sera mature post-Live, basculer sur une vraie
//     cohorte (JOIN producer_invitations sent_at vs used_at) — backlog
//     post-Live.
//   - Pas de discrimination producer vs draft : `admin_invite_sent` couvre
//     les 2 cas (1ère invitation à un email B2B). `admin_invite_draft_resend`
//     est exclu (relance d'un onboarding interrompu, double comptage si on
//     l'incluait).

const WINDOW_DAYS_DEFAULT = 30;

export type InvitationConversionStats = {
  windowDays: number;
  invitationsSent: number;
  onboardingsCompleted: number;
  // null si invitationsSent = 0
  conversionRatePct: number | null;
};

export async function getInvitationConversionStats(
  options: { windowDays?: number; now?: Date } = {},
): Promise<InvitationConversionStats> {
  const windowDays = options.windowDays ?? WINDOW_DAYS_DEFAULT;
  const now = options.now ?? new Date();
  const since = new Date(
    now.getTime() - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const admin = createSupabaseAdminClient();

  const sentRes = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "admin_invite_sent")
    .gte("created_at", since);

  const completedRes = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "invitation_consumed_success")
    .gte("created_at", since);

  const invitationsSent = sentRes.count ?? 0;
  const onboardingsCompleted = completedRes.count ?? 0;

  const conversionRatePct =
    invitationsSent > 0
      ? Math.round((onboardingsCompleted / invitationsSent) * 1000) / 10
      : null;

  return {
    windowDays,
    invitationsSent,
    onboardingsCompleted,
    conversionRatePct,
  };
}

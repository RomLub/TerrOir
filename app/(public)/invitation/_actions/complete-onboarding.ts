"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeIlikeEmail } from "@/lib/supabase/escape-ilike";
import { getSessionUser } from "@/lib/auth/session";
import { invitationBusinessInfoSchema } from "@/lib/auth/validators";
import { maskEmail } from "@/lib/rgpd/mask-email";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { logAdminInviteEvent } from "@/lib/audit-logs/log-admin-invite-event";

// errorField : path Zod du premier issue, exposé pour permettre à l'UI
// d'ancrer le message à côté du champ fautif.
export type State = { error?: string; errorField?: string };

export async function completeOnboardingAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const session = await getSessionUser();
  if (!session) return { error: "Session expirée" };

  const parsed = invitationBusinessInfoSchema.safeParse({
    token: formData.get("token"),
    nom_exploitation: formData.get("nom_exploitation"),
    forme_juridique: formData.get("forme_juridique"),
    siret: formData.get("siret"),
    adresse: formData.get("adresse"),
    code_postal: formData.get("code_postal"),
    commune: formData.get("commune"),
    type_production: formData.get("type_production"),
    type_production_precision:
      formData.get("type_production_precision") ?? undefined,
    message: formData.get("message") ?? undefined,
  });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      error: firstIssue?.message ?? "Saisie invalide",
      errorField: firstIssue?.path[0]?.toString(),
    };
  }

  const admin = createSupabaseAdminClient();
  const token = parsed.data.token?.trim();

  // On retient l'invitation à marquer used_at SI on est en flux classique
  // (token présent). En flux reprise (Phase 4), pas d'invitation à marquer.
  let invitationId: string | null = null;
  // T-307 : préfixe (8 chars) du token capturé à la lecture pour audit log
  // race lost. Token complet jamais loggé — c'est le secret de jonction
  // email→inscription, traité comme un credential.
  let tokenPrefix: string | null = null;

  if (token) {
    const { data: invitation } = await admin
      .from("producer_invitations")
      .select("id, email, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();

    if (!invitation) return { error: "Invitation introuvable" };
    if (invitation.used_at) return { error: "Invitation déjà utilisée" };
    if (new Date(invitation.expires_at) < new Date()) {
      // T-081 — audit log forensique : claim ratée pour cause d'expiration.
      // userId = session.id (user loggé qui tente de finaliser un wizard
      // entamé avec un lien désormais expiré — ex: laissé ouvert plusieurs
      // jours dans un onglet). token_prefix only (pas l'email en clair).
      // Set cohérent T-081 — 4 sites alignés (cf. note dans
      // lib/audit-logs/log-admin-invite-event.ts AdminInviteExpiredSurface).
      await logAdminInviteEvent(session.id, {
        type: "admin_invite_expired",
        invitation_id: invitation.id,
        token_prefix: token.substring(0, 8),
        surface: "complete_onboarding",
      });
      return { error: "Invitation expirée" };
    }

    // T-110 : comparaison case-insensitive — la session.email vient de
    // Supabase Auth (potentiellement en casse mixte) et invitation.email
    // de la table producer_invitations. Aligné avec le lookup .ilike sur
    // users/admin_users dans le reste du flow invitation.
    const sessionEmail = (session.email ?? "").toLowerCase();
    const invitationEmail = String(invitation.email ?? "").toLowerCase();
    if (!sessionEmail || sessionEmail !== invitationEmail) {
      return { error: "Email de session ne correspond pas à l'invitation" };
    }
    invitationId = invitation.id as string;
    tokenPrefix = token.substring(0, 8);
  } else {
    const { data: producer } = await admin
      .from("producers")
      .select("statut")
      .eq("user_id", session.id)
      .maybeSingle();

    if (!producer) return { error: "Aucun profil producteur à compléter" };
    if (producer.statut !== "draft") {
      return { error: "Profil producteur déjà finalisé" };
    }
  }

  // Refonte funnel 2 étapes : l'identité (prenom/nom/telephone) est déjà écrite
  // dans `users` à l'étape « compte » (création/login/become/signup). Cette
  // étape ne touche QUE l'exploitation.
  //
  // UPDATE atomique via RPC update_producer_onboarding : écrit les champs
  // business + bascule statut='draft' → 'pending', en une seule transaction.
  const { error: producerError } = await admin.rpc("update_producer_onboarding", {
    p_user_id: session.id,
    p_nom_exploitation: parsed.data.nom_exploitation,
    p_forme_juridique: parsed.data.forme_juridique,
    p_siret: parsed.data.siret,
    p_adresse: parsed.data.adresse,
    p_code_postal: parsed.data.code_postal,
    p_commune: parsed.data.commune,
    p_type_production: parsed.data.type_production,
    p_type_production_precision:
      parsed.data.type_production === "autre"
        ? (parsed.data.type_production_precision ?? null)
        : null,
  });

  if (producerError) {
    return { error: `Finalisation échouée : ${producerError.message}` };
  }

  // On marque used_at SEULEMENT maintenant (pas au createAccount/login). Cela
  // permet à un utilisateur qui abandonne à l'étape 2 ou 3 de recliquer sur
  // le lien email dans les 7 jours de validité de l'invitation pour reprendre.
  //
  // T-307 — Guard race condition : .is('used_at', null) + .select('id')
  // garantit l'atomicité Postgres face à 2 requêtes concurrentes qui
  // franchiraient le check ligne 54 simultanément. La 2ᵉ transaction voit
  // used_at déjà set par la 1ʳᵉ → 0 rows updated. Comme les UPDATE users +
  // producers précédents sont idempotents (mêmes payloads), on log + audit
  // + continue plutôt que rejeter — UX cohérente avec un onboarding en
  // réalité réussi côté data.
  if (invitationId) {
    const { data: claimed, error: claimError } = await admin
      .from("producer_invitations")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invitationId)
      .is("used_at", null)
      .select("id");

    if (claimError) {
      console.error(
        `[INVITATION_CLAIM_ERROR] invitationId=${invitationId} error=${claimError.message}`,
      );
    } else if (claimed && claimed.length === 0) {
      console.warn(
        `[INVITATION_RACE_LOST] invitationId=${invitationId} userId=${session.id}`,
      );
      await logAuthEvent({
        eventType: "invitation_consumed_race_lost",
        userId: session.id,
        metadata: {
          invitation_id: invitationId,
          token_prefix: tokenPrefix,
        },
      });
    } else {
      // T-310 : success path symétrique race_lost ci-dessus. Émis quand le
      // UPDATE used_at a effectivement marqué la ligne (rowcount=1) — c'est
      // le moment forensique où l'invitation est réellement "consumed".
      // Cohabitation avec role_changed (login-and-upgrade.ts +
      // accept-invitation.ts) : sémantique distincte — role_changed = transition
      // rôle DB générique, invitation_consumed_success = token spécifiquement
      // marqué used_at (lien email "claim").
      await logAuthEvent({
        eventType: "invitation_consumed_success",
        userId: session.id,
        metadata: {
          invitation_id: invitationId,
          token_prefix: tokenPrefix,
        },
      });
    }
  }

  // Bump du lead matching : producer_interests.statut 'contacted' → 'onboarded'.
  // Match email case-insensitive (ilike sans wildcards), scope strict à 'contacted'
  // pour rester cohérent avec le flow normal (new → contacted → onboarded).
  // Si 0 rows (producer invité direct sans lead, ou déjà en 'onboarded'), no-op
  // silencieux. Si échec DB, on log mais on ne bloque pas la finalisation
  // wizard — l'onboarding producer a réussi, le bump lead est nice-to-have.
  if (session.email) {
    const { data: bumped, error: bumpError } = await admin
      .from("producer_interests")
      .update({
        statut: "onboarded",
        // Enrichissement : à l'étape 1 le lead n'a que le perso ; on y ajoute
        // l'exploitation + le message saisis ici (refonte funnel).
        nom_exploitation: parsed.data.nom_exploitation,
        commune: parsed.data.commune,
        message: parsed.data.message ?? null,
      })
      .ilike("email", escapeIlikeEmail(session.email))
      .eq("statut", "contacted")
      .select("id");
    if (bumpError) {
      console.warn(
        `[LEAD_ONBOARDED_WARN] Failed to bump producer_interests for ${maskEmail(session.email)}: ${bumpError.message}`,
      );
    } else if ((bumped?.length ?? 0) > 0) {
      console.info(
        `[LEAD_ONBOARDED] Bumped ${bumped?.length} lead(s) to 'onboarded' for ${maskEmail(session.email)}`,
      );
    }
  }

  // Invalide le cache RSC du root layout AVANT redirect — flow producer
  // onboarding pose les cookies session à l'étape 1 (cf. create-account.ts /
  // login-and-upgrade.ts via signInWithPassword). Si l'user n'était pas loggé
  // avant /invitation (cas "new" ou "consumer-login"), le RootLayout est
  // cached avec initial.user=null pendant tout le wizard. Sans revalidatePath,
  // la transition vers /ma-page réutiliserait ce cache → bug navbar identique
  // au signup. Pattern strictement identique au fix login PR #13.
  revalidatePath("/", "layout");
  redirect("/ma-page?onboarded=1");
}

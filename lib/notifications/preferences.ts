import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Préférences notifications email par utilisateur. Cf. migration
// 20260506140214_add_producer_responses_and_notification_prefs.sql.
//
// Doctrine : opt-out (toutes prefs activées par défaut), cohérent avec
// l'engagement contractuel CGU 6.4 (notification réponse producer) et
// le pattern produit existant (sms_optin user-default à false en BDD
// mais formellement opt-in côté UI). Une row absente = toutes prefs au
// default true (virtual defaults — pas besoin de seed à la création
// de compte). La row n'est INSERT que sur premier toggle UI ou via
// upsertUserNotificationPreference.

export type NotificationPreferenceKey = "email_review_response";

export interface UserNotificationPreferences {
  email_review_response: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: UserNotificationPreferences = {
  email_review_response: true,
};

// Lecture des prefs avec virtual defaults : si la row n'existe pas (cas
// nominal pour les comptes pré-2026-05-06 et tout nouveau compte n'ayant
// jamais touché ses prefs), on retourne DEFAULT_NOTIFICATION_PREFERENCES
// sans INSERT. Ça évite de polluer la table avec des rows "default partout"
// pour les utilisateurs qui n'ont jamais ouvert la page paramètres.
//
// Utilise admin client (service_role) car appelé depuis les helpers d'envoi
// email (send-review-response-email.ts) qui n'ont pas de session user dans
// le scope. Les prefs étant strictement read-self via RLS, l'admin bypass
// est légitime côté backend (jamais exposé au browser).
export async function getUserNotificationPreferences(
  userId: string,
): Promise<UserNotificationPreferences> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("user_notification_preferences")
    .select("email_review_response")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // Fail-safe : si la lookup throw (DB down, RLS misconfig), on retourne
    // les defaults — équivaut à "envoyer l'email" pour email_review_response.
    // Préférence produit : ne pas casser un envoi engagement-contractuel
    // (CGU 6.4) à cause d'un échec de lookup prefs. Le user pourra toujours
    // se désabonner après réception, et un volume anormal d'erreurs
    // remontera via le warn ci-dessous.
    console.warn(
      `[NOTIF_PREFS_READ_WARN] user_id=${userId} error=${error.message} — falling back to defaults`,
    );
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  if (!data) {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  return {
    email_review_response: data.email_review_response,
  };
}

// Helper booléen utilisé par les call sites d'envoi email avant
// resend.emails.send (ex: send-review-response-email.ts). Garde la
// décision opt-out localisée et grep-able.
export async function shouldSendEmail(
  userId: string,
  key: NotificationPreferenceKey,
): Promise<boolean> {
  const prefs = await getUserNotificationPreferences(userId);
  return prefs[key];
}

// Upsert une pref. Utilisé depuis la route consumer PATCH
// /api/consumer/notification-preferences. Admin client utilisé
// volontairement : le caller route a déjà validé session.id == userId
// avant appel. Pas de bypass de check applicatif (cf. route).
export async function upsertUserNotificationPreference(
  userId: string,
  key: NotificationPreferenceKey,
  value: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("user_notification_preferences")
    .upsert(
      {
        user_id: userId,
        [key]: value,
        // updated_at géré par trigger user_notification_preferences_set_updated_at
      },
      { onConflict: "user_id" },
    );

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

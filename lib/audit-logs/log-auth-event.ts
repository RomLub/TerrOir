import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maskIp } from "@/lib/rgpd/mask-ip";

// Helper unifié pour pousser un event sensible auth dans public.audit_logs
// (cf. migration 20260427100000_create_audit_logs.sql).
//
// Contrat fail-safe : un échec d'écriture audit ne doit JAMAIS casser le
// flow auth principal (l'user a fait un login valide → on ne lui rejette
// pas la session parce que la table audit est down). Toutes les erreurs
// sont swallow + console.warn pour Vercel, jamais re-throw.
//
// Performance : await assumé. Un INSERT simple en JSONB indexé reste sous
// les 50ms en pratique. Fire-and-forget est tentant mais dangereux en
// server action Next.js — la promise peut être coupée par le retour de
// la response avant l'écriture, perdant l'event silencieusement (anti-
// pattern audit/forensique).
//
// Service_role obligatoire : la table audit_logs n'a pas de policy INSERT,
// seul le bypass RLS du service_role permet d'écrire. Un client browser
// authentifié ne pourra jamais forger un event (même s'il essayait).

// T-080 Phase 1 : source unique des event_types Auth. Array runtime
// dérivé en type union pour rester strictement aligné avec la déclaration
// historique (`AuthEventType`) tout en exposant la liste itérable côté UI
// admin (page /audit-logs filtres). Pas de duplication possible : le type
// est calculé via `(typeof ...)[number]`.
export const AUTH_EVENT_TYPES = [
  "password_reset_request",
  "password_changed",
  "account_login_password",
  "account_login_magic_link",
  "account_logout",
  // Phase 3 multi-events (T-081 PR-A) — events Auth additionnels pour
  // couverture forensique élargie. Cohérent contrat fail-safe
  // (swallow + console.warn, pas de re-throw) et même surface params.
  "account_signup",
  "account_deleted",
  "email_change",
  "admin_login",
  "role_changed",
  // T-307 : race condition perdue sur consommation token invitation.
  // Émis quand le UPDATE producer_invitations.used_at concurrent affecte
  // 0 rows (le claim a été grillé par une transaction parallèle). Sert de
  // signal forensique : volume anormal = soupçon d'attaque double-click /
  // replay automatisé sur lien d'invitation.
  "invitation_consumed_race_lost",
  // T-310 : audit log forensique flow invitation producer (cluster cohérent
  // race_lost ci-dessus). Émis par les server actions admin/* + producer/*.
  //   - invitation_created : admin a créé une invitation (POST
  //     /api/admin/producers/invite). userId = admin créateur, metadata
  //     embarque invitation_id + email cible + token_prefix.
  //   - invitation_revoked : pré-déclaration. Pas de call site actuel — la
  //     fonction admin de révocation d'invitation pending n'est pas encore
  //     implémentée. Type pré-déclaré pour qu'un câblage futur n'ait qu'à
  //     appeler logAuthEvent sans toucher à l'enum (évite la dette).
  //   - invitation_consumed_success : émis depuis completeOnboardingAction
  //     quand le UPDATE producer_invitations.used_at affecte 1 row (token
  //     marqué consumed avec succès). Pendant symétrique de race_lost ci-
  //     dessus, sémantique propre : "consumed = used_at marqué".
  "invitation_created",
  "invitation_revoked",
  "invitation_consumed_success",
  // T-309 : tentative login échouée (signInWithPassword fail). Émis depuis
  // loginAction quand Supabase rejette les credentials. userId = null (user
  // pas authentifié), metadata embarque email tenté + reason_code catégoriel
  // (invalid_credentials | email_not_confirmed | rate_limited | technical)
  // pour permettre détection forensique brute-force / énumération.
  "login_failed",
  // T-305 PR-B : cap rate-limit applicatif dépassé. Émis depuis chaque call
  // site auth (signup, login, magic_link, recovery, invitation create/login)
  // quand consumeRateLimit() retourne success=false. userId=null (user souvent
  // non authentifié au moment du rate-limit) + metadata { route, cap, reset }
  // pour grep forensique pattern d'attaque (bruteforce IP, flooding recovery).
  // Cap rate-limited Supabase distinct (cf. login_failed reason_code=rate_limited
  // côté T-309) — celui-ci est notre defensive layer applicative.
  "rate_limit_exceeded",
  // T-013 PR2 : flow A3 change_email custom (2 OTP successifs). Émis depuis
  // les server actions request-otp / verify-otp / complete-email-change.
  // Trace forensique granulaire : volume anormal de account_otp_invalid =
  // soupçon brute-force, account_otp_attempts_exceeded = invalidation forcée.
  // metadata embarque step (current|new) + email_target_masked.
  "account_otp_requested",
  "account_otp_verified",
  "account_otp_invalid",
  "account_otp_expired",
  "account_otp_attempts_exceeded",
  "account_email_change_completed",
  // T-081 Phase 3 finale — cluster admin_invite_*. Granularité forensique
  // sur le flow `/api/admin/producers/invite` (création + relance + 409
  // pré-checks) et sur les 4 server actions producer/* qui claim un token
  // (détection user-side d'un lien expiré). Cohabitation sémantique avec
  // `invitation_created` (déjà émis ligne 61) qui marque l'INSERT DB :
  // - invitation_created = INSERT producer_invitations OK (event "DB").
  // - admin_invite_sent / admin_invite_draft_resend = email Resend OK
  //   (event "transport"). Émis APRÈS sendTemplate succès. Mutuellement
  //   exclusifs : un POST /invite émet l'un OU l'autre, jamais les deux,
  //   selon le flag isDraftResend (relance d'un onboarding abandonné).
  // - admin_invite_blocked_admin = 409 pré-check email = admin existant.
  // - admin_invite_blocked_producer = 409 pré-check email = producteur
  //   déjà inscrit (statut != 'draft'). Le 409 'draft_resend_confirm_required'
  //   N'est PAS un blocage (juste une demande de confirmation UX) — pas d'event.
  // - admin_invite_expired = check `expires_at < now()` sur les 4 server
  //   actions producer/* (create-account, login-and-upgrade, accept-invitation,
  //   complete-onboarding). 1 event = 1 tentative de claim ratée pour cause
  //   d'expiration. userId nullable : sur create-account l'user n'a pas
  //   encore de session.
  "admin_invite_sent",
  "admin_invite_draft_resend",
  "admin_invite_blocked_admin",
  "admin_invite_blocked_producer",
  "admin_invite_expired",
  // F-011 (audit pré-launch 2026-05-10) : RGPD art. 20 portabilité user-side.
  // Émis par exportMyDataAction à chaque téléchargement zip réussi. Permet
  // de tracer forensique un abus (volume anormal d'exports) ou une demande
  // CNIL ("prouvez que l'user X a bien pu exercer son droit"). userId =
  // session.id, metadata embarque counts (orders, reviews, notifications).
  "user_data_exported",
] as const;

export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

type LogAuthEventParams = {
  eventType: AuthEventType;
  userId?: string | null;
  metadata?: Record<string, unknown>;
  // Optionnel : si non fourni, le helper tente headers() (Next.js).
  // Utile pour les flows où le contexte request n'est pas accessible
  // (ex: callback différé, job de fond).
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function logAuthEvent(params: LogAuthEventParams): Promise<void> {
  try {
    const { ipAddress, userAgent } = await resolveRequestContext(params);
    // F-010 (audit pré-launch 2026-05-10) : doctrine T-200 r1 — on ne stocke
    // jamais l'IP en clair dans audit_logs. /24 IPv4 / /64 IPv6 reste
    // exploitable forensique (corrélation sous-réseau attaquant) sans
    // identifier directement la personne.
    const maskedIp = maskIp(ipAddress);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      user_id: params.userId ?? null,
      event_type: params.eventType,
      metadata: params.metadata ?? {},
      ip_address: maskedIp,
      user_agent: userAgent,
    });
    if (error) {
      console.warn(
        `AUDIT_LOG_INSERT_WARN event=${params.eventType} error=${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `AUDIT_LOG_WRITE_WARN event=${params.eventType} error=${(err as Error).message}`,
    );
  }
}

// Extrait IP + UA depuis un objet Headers standard (Web Fetch API). Exposé
// pour les call sites qui ont déjà un Request en main et veulent éviter
// l'aller-retour via next/headers().
//
// IP : x-forwarded-for est une chaîne CSV "client, proxy1, proxy2" sur
// Vercel — la 1re entrée est l'IP client réelle. Fallback x-real-ip pour
// les autres reverse-proxies.
export function extractRequestContext(headersList: Headers): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwarded = headersList.get("x-forwarded-for");
  const ipAddress =
    forwarded?.split(",")[0]?.trim() || headersList.get("x-real-ip") || null;
  const userAgent = headersList.get("user-agent") || null;
  return { ipAddress, userAgent };
}

async function resolveRequestContext(params: LogAuthEventParams): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  // Mode explicite : si l'appelant a fourni au moins l'un des deux, on
  // prend ce qu'il a passé tel quel (null compris).
  if (params.ipAddress !== undefined || params.userAgent !== undefined) {
    return {
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    };
  }
  // Mode auto : tenter headers() Next.js. Lance une erreur si appelé
  // hors d'un scope server (route handler / server action) — on swallow.
  try {
    return extractRequestContext(await headers());
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

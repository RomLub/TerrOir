import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

export type AuthEventType =
  | "password_reset_request"
  | "password_changed"
  | "account_login_password"
  | "account_login_magic_link"
  | "account_logout"
  // Phase 3 multi-events (T-081 PR-A) — events Auth additionnels pour
  // couverture forensique élargie. Cohérent contrat fail-safe
  // (swallow + console.warn, pas de re-throw) et même surface params.
  | "account_signup"
  | "account_deleted"
  | "email_change"
  | "admin_login"
  | "role_changed"
  // T-307 : race condition perdue sur consommation token invitation.
  // Émis quand le UPDATE producer_invitations.used_at concurrent affecte
  // 0 rows (le claim a été grillé par une transaction parallèle). Sert de
  // signal forensique : volume anormal = soupçon d'attaque double-click /
  // replay automatisé sur lien d'invitation.
  | "invitation_consumed_race_lost";

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
    const { ipAddress, userAgent } = resolveRequestContext(params);
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      user_id: params.userId ?? null,
      event_type: params.eventType,
      metadata: params.metadata ?? {},
      ip_address: ipAddress,
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

function resolveRequestContext(params: LogAuthEventParams): {
  ipAddress: string | null;
  userAgent: string | null;
} {
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
    return extractRequestContext(headers());
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

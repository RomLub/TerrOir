import "server-only";
import { logAuthEvent } from "./log-auth-event";

// T-081 Phase 3 finale — wrapper typé du cluster `admin_invite_*` au-dessus
// de logAuthEvent (la primitive bas-niveau qui INSERT dans public.audit_logs).
//
// But unique : verrouiller le schéma de metadata par event_type via une union
// discriminée TypeScript. Sans ce wrapper, chaque call site recompose son
// metadata à la main et la dérive de schéma est inévitable (un champ oublié
// sur 1 site, un champ renommé sur un autre — typique côté forensique). Avec
// le wrapper, le compilateur refuse un payload incomplet ou déformé.
//
// Pas de logique additionnelle (pas de retry, pas de validation runtime, pas
// de masquage) : tout passe à travers logAuthEvent qui garde le contrat
// fail-safe (swallow + console.warn). Mocker logAuthEvent en test mocke donc
// transitivement ce helper — les tests existants continuent de fonctionner.

// Surfaces possibles pour admin_invite_expired : 4 server actions producer/*
// qui claim un token. Union nommée pour empêcher un futur "5e site" de logger
// avec une valeur hors-set sans ajout explicite ici (et donc relecture du
// cluster T-081, pas de désalignement silencieux).
export type AdminInviteExpiredSurface =
  | "create_account"
  | "login_and_upgrade"
  | "accept_invitation"
  | "complete_onboarding";

export type AdminInviteEvent =
  | {
      type: "admin_invite_sent";
      invitation_id: string;
      invitation_email: string;
      resend_id: string;
    }
  | {
      type: "admin_invite_draft_resend";
      invitation_id: string;
      invitation_email: string;
      resend_id: string;
    }
  | {
      type: "admin_invite_blocked_admin";
      invitation_email: string;
    }
  | {
      type: "admin_invite_blocked_producer";
      invitation_email: string;
      statut: string | null;
    }
  | {
      type: "admin_invite_expired";
      invitation_id: string;
      token_prefix: string;
      surface: AdminInviteExpiredSurface;
    };

export async function logAdminInviteEvent(
  userId: string | null,
  event: AdminInviteEvent,
): Promise<void> {
  const { type, ...metadata } = event;
  await logAuthEvent({
    eventType: type,
    userId,
    metadata,
  });
}

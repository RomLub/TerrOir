// Types partagés admin /producer-interests — utilisés à la fois côté
// Server Component (fetch SSR) et côté Client Component (rendu/interactions).
//
// Source de vérité du schéma : CHECK constraints SQL sur la table
// public.producer_interests :
//   - statut  : 'new' | 'contacted' | 'onboarded' (default 'new')
//   - source  : 'formulaire_public' | 'invitation_directe' (default
//                'formulaire_public', NOT NULL)
//
// Ces types sont colocalisés ici plutôt que dans _components/types.ts pour
// permettre l'import depuis API routes (server) ET Client Components sans
// faire transiter par un fichier server-only.

export type LeadStatus = "new" | "contacted" | "onboarded";

export type LeadSource = "formulaire_public" | "invitation_directe";

// current_step ∈ [1..6] — étapes du funnel (cf. chantier 3, 0.5). La
// signification diffère entre prospecté et spontané (frises distinctes), mais
// la colonne est un simple entier borné côté DB.
export type LeadFunnelStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface AdminProducerInterestRow {
  id: string;
  created_at: string;
  prenom: string | null;
  nom: string;
  email: string;
  telephone: string | null;
  nom_exploitation: string | null;
  commune: string | null;
  especes: string[] | null;
  message: string | null;
  statut: LeadStatus;
  source: LeadSource;
  // Champs CRM (chantier 3, Phase 1).
  assigned_to: string | null;
  current_step: number;
  first_contact_at: string | null;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
  abandoned_at: string | null;
  abandoned_reason: string | null;
}

// Liste exhaustive des statuts — utilisée pour validation Zod côté API
// route + pour itération sécurisée côté UI (counts par statut).
export const LEAD_STATUSES: readonly LeadStatus[] = [
  "new",
  "contacted",
  "onboarded",
] as const;

// Canaux + sens d'une interaction (producer_interest_followups). Miroir des
// CHECK SQL (migration 20260522090000).
export type FollowupChannel = "email" | "phone" | "rdv";
export type FollowupDirection = "outbound" | "inbound";

export const FOLLOWUP_CHANNELS: readonly FollowupChannel[] = [
  "email",
  "phone",
  "rdv",
] as const;
export const FOLLOWUP_DIRECTIONS: readonly FollowupDirection[] = [
  "outbound",
  "inbound",
] as const;

export interface LeadFollowupRow {
  id: string;
  lead_id: string;
  occurred_at: string;
  channel: FollowupChannel;
  direction: FollowupDirection;
  is_automatic: boolean;
  relance_step: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

// Colonnes SELECT canoniques (réutilisées par fetch list + get + detail).
export const PRODUCER_INTEREST_COLUMNS =
  "id, created_at, prenom, nom, email, telephone, nom_exploitation, commune, especes, message, statut, source, assigned_to, current_step, first_contact_at, last_contact_at, next_follow_up_at, abandoned_at, abandoned_reason";

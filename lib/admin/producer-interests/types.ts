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
}

// Liste exhaustive des statuts — utilisée pour validation Zod côté API
// route + pour itération sécurisée côté UI (counts par statut).
export const LEAD_STATUSES: readonly LeadStatus[] = [
  "new",
  "contacted",
  "onboarded",
] as const;

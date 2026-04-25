export type LeadStatus = "new" | "contacted" | "onboarded";

export interface Lead {
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
}

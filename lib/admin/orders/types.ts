// Chantier 5 — types partagés du suivi commandes admin. Extraits de
// SuiviCommandesClient lors de la factorisation de la query dans
// lib/admin/orders/fetch.ts (cohérence avec lib/admin/producers, etc.).

export type Status =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "refunded";

export type AdminOrder = {
  id: string;
  code_commande: string | null;
  client: string;
  producer: string;
  created_at: string;
  date_retrait: string | null;
  slot_label: string;
  total: number;
  status: Status;
  closure_reason: string | null;
};

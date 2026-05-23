import type { ProducerStatus } from "@/components/ui/producer-status-badge";

// Types partagés cluster admin/producers — extraits de
// `app/(admin)/gestion-producteurs/page.tsx` au moment du refacto SSR
// (PR refactor/admin-pattern-uniform). Source de vérité pour les composants
// Server + Client de la page, l'API route PATCH statut et les tests.

// Re-export pour ne pas obliger les consumers à importer depuis
// components/ui/* quand ils ne consomment qu'un type métier (pattern de
// colocation : types métier dans lib/admin/*, UI dans components/ui/*).
export type { ProducerStatus };

// Row producer telle qu'exposée par la page admin (denormalisée + jointure
// users.email + formatage city/plan/joinedAt côté fetcher pour que le client
// n'ait pas à connaître la structure DB).
export type AdminProducerRow = {
  id: string;
  slug: string;
  name: string;
  city: string;
  status: ProducerStatus;
  plan: string;
  joinedAt: string;
  email: string;
  // Chantier 4 — coordonnées de contact via jointure public.users :
  //   contactName : "prenom nom" (ou "—" si les deux sont vides).
  //   phone       : telephone brut (ou null) — rendu en lien tel: côté UI.
  contactName: string;
  phone: string | null;
  // Permet le pré-filtrage `?user_id=<uuid>` (deep-link depuis /audit-logs).
  // Peut être null sur les vieilles rows ou les producers en draft sans user lié.
  userId: string | null;
  // Chantier 3 Phase 5 — signaux de validation admin :
  //   publicationRequested : demande de publication en attente (non public).
  //   bioPending           : bio déclaré, en attente de validation admin.
  //   bioValidated         : bio déclaré ET validé (badge public actif).
  publicationRequested: boolean;
  bioPending: boolean;
  bioValidated: boolean;
};

// Filtres UI exposés dans la page. 'all' = pas de filtre, les autres ciblent
// la valeur exacte du statut sauf 'active' qui agrège active+public.
export type ProducerStatusFilter =
  | "all"
  | "pending"
  | "active"
  | "suspended"
  | "draft"
  | "deleted";

// Source de vérité des valeurs de filtre UI (sert au parsing du query param
// `?status=` et aux tests). Ordre = ordre d'affichage des onglets.
export const PRODUCER_STATUS_FILTERS = [
  "all",
  "pending",
  "active",
  "suspended",
  "draft",
  "deleted",
] as const satisfies readonly ProducerStatusFilter[];

// Parse fail-safe du query param `?status=` (deep-link depuis le cockpit
// dashboard « Producteurs à valider » → ?status=pending, ou depuis le journal
// d'audit). Toute valeur absente/invalide retombe sur 'all'. Mirroir du
// pattern parseDashboardPeriod (chantier 2).
export function parseProducerStatusFilter(
  raw: string | string[] | undefined,
): ProducerStatusFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (PRODUCER_STATUS_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as ProducerStatusFilter)
    : "all";
}

// Liste des statuts considérés comme "valides côté UI". Le check constraint
// DB liste exactement ces 6 valeurs (cf. producers_statut_check, migration
// 20260422200000). Source de vérité pour la validation Zod côté route PATCH
// /api/admin/producers/[id]/statut.
export const PRODUCER_STATUS_VALUES = [
  "draft",
  "pending",
  "active",
  "public",
  "suspended",
  "deleted",
] as const satisfies readonly ProducerStatus[];

// Mapping abonnement_niveau → label affiché. Centralisé ici pour réutilisation
// (page admin, futurs exports, etc.).
export const PLAN_LABEL: Record<string, string> = {
  starter: "Découverte",
  pro: "Pro",
  premium: "Premium",
};

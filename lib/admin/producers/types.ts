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
  // Permet le pré-filtrage `?user_id=<uuid>` (deep-link depuis /audit-logs).
  // Peut être null sur les vieilles rows ou les producers en draft sans user lié.
  userId: string | null;
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

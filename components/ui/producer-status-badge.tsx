import { StatusDotBadge } from "./status-dot-badge";

// Mirror du pattern OrderStatusBadge pour les statuts producer. Consomme
// StatusDotBadge (pill + dot) pour rester visuellement cohérent avec
// gestion-producteurs admin. La palette est exhaustive sur les 6 valeurs
// de la DB check constraint (draft/pending/active/public/suspended/deleted,
// migration 20260422200000_rgpd_account_deletion.sql).

export type ProducerStatus =
  | "draft"
  | "pending"
  | "active"
  | "public"
  | "suspended"
  | "deleted";

type Meta = { label: string; bg: string; text: string; dot: string };

const META: Record<ProducerStatus, Meta> = {
  draft: {
    label: "Brouillon",
    bg: "bg-slate-100",
    text: "text-slate-600",
    dot: "bg-slate-400",
  },
  pending: {
    label: "En attente",
    bg: "bg-amber-50",
    text: "text-amber-800",
    dot: "bg-amber-500",
  },
  active: {
    label: "Validé",
    bg: "bg-amber-100",
    text: "text-amber-900",
    dot: "bg-amber-600",
  },
  public: {
    label: "Public",
    bg: "bg-terroir-green-100",
    text: "text-terroir-green-700",
    dot: "bg-terroir-green-700",
  },
  suspended: {
    label: "Suspendu",
    bg: "bg-red-100",
    text: "text-red-700",
    dot: "bg-red-500",
  },
  deleted: {
    label: "Supprimé",
    bg: "bg-slate-100",
    text: "text-slate-600",
    dot: "bg-slate-400",
  },
};

export function ProducerStatusBadge({ status }: { status: ProducerStatus }) {
  return <StatusDotBadge {...META[status]} />;
}

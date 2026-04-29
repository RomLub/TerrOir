import type { BadgeVariant } from "@/components/ui/badge";

// T-414 — élargissement enum payouts.statut (pending / processing / paid /
// failed). Mapping isolé du Server Component revenus/page.tsx pour permettre
// le test unitaire sans rendering async.

export type PayoutStatus = "pending" | "processing" | "paid" | "failed";

export type PayoutBadgeConfig = {
  variant: BadgeVariant;
  label: string;
};

const STATUS_BADGE_MAP: Record<PayoutStatus, PayoutBadgeConfig> = {
  pending: { variant: "gray", label: "En file d'attente" },
  processing: { variant: "blue", label: "Virement en cours" },
  paid: { variant: "green", label: "Viré" },
  failed: { variant: "danger", label: "Échec, contactez-nous" },
};

const FALLBACK: PayoutBadgeConfig = STATUS_BADGE_MAP.pending;

export function mapStatusToBadge(statut: string): PayoutBadgeConfig {
  return STATUS_BADGE_MAP[statut as PayoutStatus] ?? FALLBACK;
}

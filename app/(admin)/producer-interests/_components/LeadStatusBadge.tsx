import { StatusDotBadge } from "@/components/ui";
import type { LeadStatus } from "./types";

// Palette locale (spécifique aux 3 statuts leads : new/contacted/onboarded).
// Consomme StatusDotBadge partagé pour le rendu (Phase B1 consolidation).

const META: Record<LeadStatus, { label: string; bg: string; text: string; dot: string }> = {
  new: {
    label: "Nouveau",
    bg: "bg-blue-50",
    text: "text-blue-700",
    dot: "bg-blue-500",
  },
  contacted: {
    label: "Contacté",
    bg: "bg-amber-50",
    text: "text-amber-800",
    dot: "bg-amber-500",
  },
  onboarded: {
    label: "Onboardé",
    bg: "bg-terroir-green-100",
    text: "text-terroir-green-700",
    dot: "bg-terroir-green-700",
  },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <StatusDotBadge {...META[status]} />;
}

import { StatusDotBadge } from "@/components/ui";
import type { LeadSource } from "./types";

const META: Record<
  LeadSource,
  { label: string; bg: string; text: string; dot: string }
> = {
  formulaire_public: {
    label: "Public",
    bg: "bg-terroir-green-100",
    text: "text-terroir-green-700",
    dot: "bg-terroir-green-700",
  },
  invitation_directe: {
    label: "Invité",
    bg: "bg-amber-50",
    text: "text-amber-800",
    dot: "bg-amber-500",
  },
};

export function LeadSourceBadge({ source }: { source: LeadSource }) {
  return <StatusDotBadge {...META[source]} />;
}

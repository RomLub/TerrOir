import type { LeadStatus } from "./types";

const META: Record<LeadStatus, { label: string; dot: string; bg: string; text: string }> = {
  new: {
    label: "Nouveau",
    dot: "bg-blue-500",
    bg: "bg-blue-50",
    text: "text-blue-700",
  },
  contacted: {
    label: "Contacté",
    dot: "bg-amber-500",
    bg: "bg-amber-50",
    text: "text-amber-800",
  },
  onboarded: {
    label: "Onboardé",
    dot: "bg-terroir-green-700",
    bg: "bg-terroir-green-100",
    text: "text-terroir-green-700",
  },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const meta = META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${meta.bg} ${meta.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

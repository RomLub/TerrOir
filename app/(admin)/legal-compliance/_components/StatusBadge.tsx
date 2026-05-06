import type { CGUStatus } from "@/lib/legal/compliance";

const META: Record<
  CGUStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  accepted_current: {
    label: "À jour",
    bg: "bg-terroir-green-100",
    text: "text-terroir-green-700",
    dot: "bg-terroir-green-700",
  },
  accepted_outdated: {
    label: "Obsolète",
    bg: "bg-amber-100",
    text: "text-amber-900",
    dot: "bg-amber-600",
  },
  never_accepted: {
    label: "Jamais acceptée",
    bg: "bg-red-100",
    text: "text-red-700",
    dot: "bg-red-500",
  },
};

export function ComplianceStatusBadge({ status }: { status: CGUStatus }) {
  const meta = META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${meta.bg} ${meta.text}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
        aria-hidden
      />
      {meta.label}
    </span>
  );
}

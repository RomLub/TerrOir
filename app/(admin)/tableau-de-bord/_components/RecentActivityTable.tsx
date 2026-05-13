import Link from "next/link";
import { getEventLabel } from "@/lib/audit-logs/labels";
import {
  categorizeEventType,
  CATEGORY_PALETTE,
} from "@/app/(admin)/audit-logs/_lib/categorize-event-type";
import type { AuditEventType } from "@/app/(admin)/audit-logs/_lib/event-types";
import type { AdminDashboardRecentEvent } from "@/lib/admin/dashboard/types";

// Table compacte Zone 3 — 15 derniers events whitelist. Lecture seule
// (pas de pagination ni de filtres). Chaque ligne navigue vers
// `/audit-logs?event_type=<event>` pour drill-down.
//
// Pas de réutilisation de `AuditLogsTable` : ce composant supporte
// pagination + filtres + lookup email — trop lourd pour une mini-table.
// On replicate uniquement les bouts utiles : badge catégorie + label FR.

const DATE_FORMATTER_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatTimestampParis(iso: string): string {
  try {
    return DATE_FORMATTER_PARIS.format(new Date(iso));
  } catch {
    return iso;
  }
}

// Résumé court depuis metadata. Best-effort sur les clés les plus fréquentes
// pour les events whitelist. Pas exhaustif : un event sans match retourne "—".
function summarizeMetadata(
  eventType: string,
  metadata: Record<string, unknown>,
): string {
  // Email masqué (login magic-link, account_signup)
  const emailMasked = metadata.email_masked;
  if (typeof emailMasked === "string" && emailMasked.length > 0) {
    return emailMasked;
  }
  // Order code (order_*, pickup_validated)
  const orderId = metadata.order_id;
  if (typeof orderId === "string") {
    // On affiche les 8 premiers caractères du UUID (suffisant pour
    // identification visuelle, drill-down possible via audit-logs).
    return `Commande ${orderId.slice(0, 8)}`;
  }
  // Producer response (review_id)
  const reviewId = metadata.review_id;
  if (typeof reviewId === "string") {
    return `Avis ${reviewId.slice(0, 8)}`;
  }
  // Admin invite (target email cible)
  const targetEmail = metadata.target_email;
  if (typeof targetEmail === "string") {
    return targetEmail;
  }
  return "—";
}

export type RecentActivityTableProps = {
  events: AdminDashboardRecentEvent[];
};

export function RecentActivityTable({ events }: RecentActivityTableProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-center text-[13px] text-gray-500 shadow-sm">
        Aucune activité récente.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-[13px]">
        <thead className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-600">
          <tr>
            <th className="px-4 py-2.5">Quand</th>
            <th className="px-4 py-2.5">Type</th>
            <th className="px-4 py-2.5">Événement</th>
            <th className="px-4 py-2.5">Détail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {events.map((ev) => {
            const category = categorizeEventType(
              ev.event_type as AuditEventType,
            );
            const palette = CATEGORY_PALETTE[category];
            const href = `/audit-logs?event_type=${encodeURIComponent(ev.event_type)}`;
            return (
              <tr
                key={ev.id}
                className="transition-colors hover:bg-gray-50"
              >
                <td className="px-4 py-2.5 text-gray-500 tabular-nums">
                  {formatTimestampParis(ev.created_at)}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${palette.bg} ${palette.text}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${palette.dot}`}
                      aria-hidden="true"
                    />
                    {palette.label}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={href}
                    className="text-gray-900 hover:underline"
                  >
                    {getEventLabel(ev.event_type)}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-gray-500">
                  {summarizeMetadata(ev.event_type, ev.metadata)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

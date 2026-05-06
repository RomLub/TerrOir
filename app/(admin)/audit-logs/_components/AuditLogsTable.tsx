import Link from "next/link";
import { StatusDotBadge } from "@/components/ui";
import {
  categorizeEventType,
  CATEGORY_PALETTE,
} from "../_lib/categorize-event-type";
import type { AuditEventType } from "../_lib/event-types";
import { buildProducerHref } from "../_lib/build-producer-href";
import { getEventLabel } from "@/lib/audit-logs/labels";

export type AuditLogRow = {
  id: string;
  user_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

type Props = {
  rows: AuditLogRow[];
  // Set des user_ids présents en page courante qui ont un row dans
  // public.producers — sert à afficher un badge "Prod" inline (D1).
  producerUserIds: Set<string>;
};

function shortenUuid(uuid: string): string {
  return `${uuid.slice(0, 8)}…`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function AuditLogsTable({ rows, producerUserIds }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Event</th>
            <th className="px-4 py-3 font-semibold">User</th>
            <th className="px-4 py-3 font-semibold">IP</th>
            <th className="px-4 py-3 font-semibold">User-Agent</th>
            <th className="px-4 py-3 font-semibold">Metadata</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-10 text-center text-gray-500"
              >
                Aucun event trouvé avec ces filtres.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const cat = categorizeEventType(row.event_type as AuditEventType);
              const palette = CATEGORY_PALETTE[cat];
              const isProducer =
                !!row.user_id && producerUserIds.has(row.user_id);
              return (
                <tr
                  key={row.id}
                  className="border-b border-gray-200 last:border-0 hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 align-top font-mono text-[12px] text-gray-700">
                    {formatTimestamp(row.created_at)}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusDotBadge
                      label={getEventLabel(row.event_type)}
                      bg={palette.bg}
                      text={palette.text}
                      dot={palette.dot}
                    />
                    <span
                      className="mt-1 block font-mono text-[10px] text-gray-400"
                      title="Identifiant technique de l'event"
                    >
                      {row.event_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {row.user_id ? (
                      <span
                        className="font-mono text-[12px] text-gray-700"
                        title={row.user_id}
                      >
                        {isProducer && (
                          <Link
                            href={buildProducerHref(row.user_id)}
                            className="mr-1 inline-flex rounded-full bg-terroir-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-terroir-green-700 hover:bg-terroir-green-200"
                          >
                            Prod
                          </Link>
                        )}
                        {shortenUuid(row.user_id)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-[12px] text-gray-700">
                    {row.ip_address ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td
                    className="px-4 py-3 align-top text-[12px] text-gray-700"
                    title={row.user_agent ?? undefined}
                  >
                    {row.user_agent ? (
                      truncate(row.user_agent, 32)
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {Object.keys(row.metadata ?? {}).length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-[12px] text-terroir-green-700 hover:underline">
                          Voir détails
                        </summary>
                        <pre className="mt-2 max-w-md overflow-x-auto rounded bg-gray-50 p-2 text-[11px] text-gray-800">
                          {JSON.stringify(row.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { TableStatus } from "@/components/ui/table-status";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateFr } from "@/lib/format/date";
import {
  fetchInboundEmails,
  fetchInboundUnreadCounts,
} from "@/lib/admin/inbound/fetch";
import {
  INBOUND_TAGS,
  INBOUND_TAG_LABEL,
  type InboundTag,
} from "@/lib/admin/inbound/types";
import { SectionSkeleton } from "../_components/ContentSkeletons";

// Chantier 9 — boîte mails admin (top niveau). Onglets Producteurs /
// Consommateurs / Public (tag automatique de l'expéditeur). Lecture seule de
// la table inbound_emails (alimentée par le cron IMAP).
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseTag(raw: string | undefined): InboundTag {
  return (INBOUND_TAGS as string[]).includes(raw ?? "")
    ? (raw as InboundTag)
    : "producteur";
}

// Coquille synchrone : l'en-tête s'affiche immédiatement (shell admin fixe),
// les onglets (avec compteurs non-lus) + la liste sont streamés via <Suspense>.
export default async function AdminMailsPage(props: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const sp = await props.searchParams;
  const tag = parseTag(sp.tag);

  return (
    <div>
      <AdminPageHeader
        eyebrow="Boîte de réception"
        title="Mails"
        subtitle="Reçus sur contact@terroir-local.fr"
      />

      <Suspense fallback={<SectionSkeleton rows={8} />}>
        <MailsContent tag={tag} />
      </Suspense>
    </div>
  );
}

async function MailsContent({ tag }: { tag: InboundTag }) {
  const admin = createSupabaseAdminClient();
  const [{ rows, error }, unread] = await Promise.all([
    fetchInboundEmails(admin, tag),
    fetchInboundUnreadCounts(admin),
  ]);

  return (
    <>
      {error ? (
        <p className="mb-4 text-[13px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <nav className="mb-4 flex gap-1 border-b border-gray-200">
        {INBOUND_TAGS.map((t) => {
          const active = t === tag;
          return (
            <Link
              key={t}
              href={`/mails?tag=${t}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? "border-terroir-green-700 font-semibold text-gray-900"
                  : "border-transparent font-medium text-gray-600 hover:text-gray-900"
              }`}
            >
              {INBOUND_TAG_LABEL[t]}
              {unread[t] > 0 ? (
                <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-terroir-terra-700 px-1.5 text-[11px] font-semibold text-white">
                  {unread[t] > 99 ? "99+" : unread[t]}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
              <th className="px-5 py-3 font-semibold">Expéditeur</th>
              <th className="px-5 py-3 font-semibold">Sujet</th>
              <th className="px-5 py-3 font-semibold">Reçu le</th>
              <th className="px-5 py-3 font-semibold">État</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <TableStatus kind="empty" colSpan={4} emptyLabel="Aucun mail dans cette catégorie." />
            ) : (
              rows.map((m) => (
                <tr
                  key={m.id}
                  className={`border-b border-gray-200 last:border-0 hover:bg-gray-50 ${
                    m.readAt ? "" : "font-semibold"
                  }`}
                >
                  <td className="px-5 py-4">
                    <Link href={`/mails/${m.id}`} className="text-terroir-green-700 hover:underline">
                      {m.fromName ? `${m.fromName} ` : ""}
                      <span className="text-[12px] font-normal text-gray-500">
                        &lt;{m.fromEmail}&gt;
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-gray-800">{m.subject ?? "(sans objet)"}</td>
                  <td className="px-5 py-4 text-gray-500">
                    {m.receivedAt ? formatDateFr(m.receivedAt) : "—"}
                  </td>
                  <td className="px-5 py-4 text-[12px]">
                    {m.repliedAt ? (
                      <span className="text-green-700">Répondu</span>
                    ) : m.readAt ? (
                      <span className="text-gray-400">Lu</span>
                    ) : (
                      <span className="text-terra-700">Non lu</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

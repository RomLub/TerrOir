import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateFr } from "@/lib/format/date";
import { fetchInboundEmailDetail } from "@/lib/admin/inbound/fetch";
import { INBOUND_TAG_LABEL } from "@/lib/admin/inbound/types";
import { ReplyForm } from "./_components/ReplyForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminMailDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const admin = createSupabaseAdminClient();
  const { row, error } = await fetchInboundEmailDetail(admin, id);

  if (!error && !row) notFound();

  // Marque lu à l'ouverture (si pas déjà lu). Side-effect bénin sur GET.
  if (row && !row.readAt) {
    await admin
      .from("inbound_emails")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="Mails"
        title={row?.subject ?? "(sans objet)"}
        error={error}
        right={
          <Link href="/mails" className="text-[13px] text-gray-500 underline hover:text-gray-700">
            ← Boîte de réception
          </Link>
        }
      />

      {row ? (
        <>
          <div className="mb-6 rounded-md border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-gray-900">
                  {row.fromName ? `${row.fromName} ` : ""}
                  <span className="text-[13px] text-gray-500">&lt;{row.fromEmail}&gt;</span>
                </div>
                <div className="mt-0.5 text-[12px] text-gray-400">
                  {row.receivedAt ? formatDateFr(row.receivedAt) : "—"}
                  {row.toEmail ? ` · à ${row.toEmail}` : ""}
                </div>
              </div>
              <Badge variant="gray">{INBOUND_TAG_LABEL[row.tag]}</Badge>
            </div>
            <hr className="my-4 border-gray-100" />
            <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">
              {row.bodyText?.trim()
                ? row.bodyText
                : "(Aucun contenu texte — voir le webmail OVH pour la version HTML.)"}
            </div>
          </div>

          <ReplyForm
            inboundId={row.id}
            toEmail={row.fromEmail}
            originalSubject={row.subject}
            originalBody={row.bodyText}
            originalFrom={row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail}
            originalDate={row.receivedAt ? formatDateFr(row.receivedAt) : ""}
            alreadyReplied={row.repliedAt != null}
          />
        </>
      ) : null}
    </div>
  );
}

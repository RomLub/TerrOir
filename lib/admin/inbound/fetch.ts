import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundEmailRow, InboundTag } from "./types";

// Chantier 9 — lecture de la boîte mails admin (liste par tag + détail).
// service_role : inbound_emails n'a qu'une policy admin-read.

type RawInbound = {
  id: string;
  from_email: string;
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  tag: InboundTag;
  lookup_user_id: string | null;
  lookup_lead_id: string | null;
  read_at: string | null;
  replied_at: string | null;
};

const SELECT =
  "id, from_email, from_name, to_email, subject, body_text, body_html, received_at, tag, lookup_user_id, lookup_lead_id, read_at, replied_at";

function mapRow(r: RawInbound): InboundEmailRow {
  return {
    id: r.id,
    fromEmail: r.from_email,
    fromName: r.from_name,
    toEmail: r.to_email,
    subject: r.subject,
    bodyText: r.body_text,
    bodyHtml: r.body_html,
    receivedAt: r.received_at,
    tag: r.tag,
    lookupUserId: r.lookup_user_id,
    lookupLeadId: r.lookup_lead_id,
    readAt: r.read_at,
    repliedAt: r.replied_at,
  };
}

export async function fetchInboundEmails(
  admin: SupabaseClient,
  tag: InboundTag,
): Promise<{ rows: InboundEmailRow[]; error: string | null }> {
  const { data, error } = await admin
    .from("inbound_emails")
    .select(SELECT)
    .eq("tag", tag)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) return { rows: [], error: error.message };
  return { rows: ((data ?? []) as RawInbound[]).map(mapRow), error: null };
}

// Compte des non-lus par tag (badges sidebar / onglets).
export async function fetchInboundUnreadCounts(
  admin: SupabaseClient,
): Promise<Record<InboundTag, number>> {
  const counts: Record<InboundTag, number> = {
    producteur: 0,
    consommateur: 0,
    public: 0,
  };
  const { data } = await admin
    .from("inbound_emails")
    .select("tag")
    .is("read_at", null)
    .limit(1000);
  for (const r of (data ?? []) as { tag: InboundTag }[]) {
    if (r.tag in counts) counts[r.tag] += 1;
  }
  return counts;
}

export async function fetchInboundEmailDetail(
  admin: SupabaseClient,
  id: string,
): Promise<{ row: InboundEmailRow | null; error: string | null }> {
  const { data, error } = await admin
    .from("inbound_emails")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: data ? mapRow(data as RawInbound) : null, error: null };
}

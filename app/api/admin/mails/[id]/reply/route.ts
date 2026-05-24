import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendInboundReply } from "@/lib/admin/inbound/reply";

// POST /api/admin/mails/[id]/reply — chantier 9. Répond à un email entrant
// depuis contact@ (Resend + threading). Réservé aux admins. Body :
// { subject, body }.
export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { subject?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const result = await sendInboundReply(
    admin,
    session.id,
    id,
    body.subject ?? "",
    body.body ?? "",
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  revalidatePath(`/mails/${id}`);
  revalidatePath("/mails");
  return NextResponse.json({ ok: true });
}

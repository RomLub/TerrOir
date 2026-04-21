import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { inviteProducerSchema } from "@/lib/auth/validators";

// POST body: { email: string } → { token, url, expires_at }
export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inviteProducerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const token = randomBytes(32).toString("hex");
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("producer_invitations")
    .insert({
      email: parsed.data.email,
      token,
      created_by: session.id,
    })
    .select("token, expires_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  const producerBaseUrl =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://pro.localhost:3000";
  const url = `${producerBaseUrl}/invitation?token=${data.token}`;

  return NextResponse.json({
    token: data.token,
    expires_at: data.expires_at,
    url,
  });
}

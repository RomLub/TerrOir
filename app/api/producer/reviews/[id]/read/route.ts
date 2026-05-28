import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getProducerForUser(userId: string): Promise<{ id: string } | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  return data ? { id: data.id as string } : null;
}

export async function POST(_request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const producer = await getProducerForUser(session.id);
  if (!producer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const { data: review } = await admin
    .from("reviews")
    .select("id")
    .eq("id", params.id)
    .eq("producer_id", producer.id)
    .eq("statut", "published")
    .maybeSingle();

  if (!review) {
    return NextResponse.json({ error: "Avis introuvable" }, { status: 404 });
  }

  const readAt = new Date().toISOString();
  const { error } = await admin
    .from("review_producer_reads")
    .upsert(
      {
        review_id: review.id,
        producer_id: producer.id,
        read_at: readAt,
      },
      { onConflict: "review_id" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, readAt });
}

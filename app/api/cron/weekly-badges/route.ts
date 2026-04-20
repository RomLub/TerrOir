import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Cron hebdomadaire — appelle PATCH /api/producers/[id]/badges pour chaque
// producteur actif. Séquentiel pour rester simple et éviter la pression
// DB/Stripe ; à batcher si le nombre de producteurs grossit.
export async function POST(request: Request) {
  const authError = assertCronAuth(request);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const { data: producers, error } = await admin
    .from("producers")
    .select("id")
    .eq("statut", "active");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!producers || producers.length === 0) {
    return NextResponse.json({ processed: 0, errors: [] });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET!;
  const errors: Array<{ producer_id: string; error: string }> = [];
  let processed = 0;

  for (const p of producers) {
    try {
      const res = await fetch(`${appUrl}/api/producers/${p.id}/badges`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${cronSecret}` },
      });
      if (res.ok) {
        processed += 1;
      } else {
        const text = await res.text().catch(() => "");
        errors.push({
          producer_id: p.id,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        });
      }
    } catch (e) {
      errors.push({ producer_id: p.id, error: (e as Error).message });
    }
  }

  return NextResponse.json({ processed, errors });
}

export const GET = POST;

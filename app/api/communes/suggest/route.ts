import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, getGeocodeRateLimit } from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import { fetchCommuneSuggestions } from "@/lib/geo/commune-suggestions";

// POST /api/communes/suggest — body { q }
// Autocomplétion du code postal : dès 2 caractères, propose des communes
// (avec leur CP). Conforme à docs/conventions/garde-fou-autocompletion-cp.md :
// POST (préfixe dans le body, jamais en query GET), aucun log du préfixe saisi,
// éphémère, rate-limit IP réutilisé du géocodeur.

const bodySchema = z.object({ q: z.string().trim().min(2).max(50) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "invalid_query" }, { status: 400 });
  }

  const { ipAddress } = extractRequestContext(request.headers);
  const rl = await consumeRateLimit(getGeocodeRateLimit(), ipAddress ?? "anon-no-ip");
  if (!rl.success) {
    console.warn(`[COMMUNES_SUGGEST_RATE_LIMIT] ip=${ipAddress ?? "(none)"}`);
    return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
  }

  const result = await fetchCommuneSuggestions(parsed.data.q);
  if (result.ok) {
    return NextResponse.json({ ok: true, suggestions: result.suggestions }, { status: 200 });
  }
  return NextResponse.json({ ok: false, code: result.code }, { status: 502 });
}

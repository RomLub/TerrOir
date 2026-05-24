import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, getGeocodeRateLimit } from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import { fetchAddressSuggestions } from "@/lib/geo/address-suggestions";

// POST /api/public/address/suggest — body { q, cp }
// Autocomplétion d'adresse filtrée par code postal (api-adresse.data.gouv.fr).
// Conforme à docs/conventions/garde-fou-autocompletion-cp.md : saisie dans le
// body (jamais en query GET), aucun log de la saisie, éphémère, rate-limit IP
// réutilisé du géocodeur. Sous /api/public/* → exempté du gating middleware
// (appelée depuis /onboarding, fiche en brouillon).

const bodySchema = z.object({
  q: z.string().trim().min(3).max(200),
  cp: z.string().trim().regex(/^\d{5}$/),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "invalid_query" }, { status: 400 });
  }

  const { ipAddress } = extractRequestContext(request.headers);
  const rl = await consumeRateLimit(getGeocodeRateLimit(), ipAddress ?? "anon-no-ip");
  if (!rl.success) {
    console.warn(`[ADDRESS_SUGGEST_RATE_LIMIT] ip=${ipAddress ?? "(none)"}`);
    return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
  }

  const result = await fetchAddressSuggestions(parsed.data.q, parsed.data.cp);
  if (result.ok) {
    return NextResponse.json({ ok: true, suggestions: result.suggestions }, { status: 200 });
  }
  return NextResponse.json({ ok: false, code: result.code }, { status: 502 });
}

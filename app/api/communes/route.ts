import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, getGeocodeRateLimit } from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import { fetchCommunesByPostalCode } from "@/lib/geo/communes-by-postal";

// POST /api/communes — body { cp }
// Liste les communes d'un code postal (geo.api.gouv.fr) pour la sélection au
// formulaire d'inscription producteur.
//
// Conforme à docs/conventions/garde-fou-autocompletion-cp.md :
//   - POST (CP dans le BODY, jamais en query string GET) — Règle 2.
//   - Aucun log du CP saisi (Règle 1) : seul l'IP est loggué sur hit rate-limit.
//   - Pas de persistance CP↔user (Règle 3), traitement éphémère (Règle 4).
//   - Rate-limit IP réutilisé du géocodeur (30/min, classe d'endpoint identique).

const bodySchema = z.object({ cp: z.string().trim().regex(/^\d{5}$/) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "invalid_format" }, { status: 400 });
  }

  const { ipAddress } = extractRequestContext(request.headers);
  const rl = await consumeRateLimit(getGeocodeRateLimit(), ipAddress ?? "anon-no-ip");
  if (!rl.success) {
    console.warn(`[COMMUNES_RATE_LIMIT] ip=${ipAddress ?? "(none)"}`);
    return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
  }

  const result = await fetchCommunesByPostalCode(parsed.data.cp);
  if (result.ok) {
    return NextResponse.json({ ok: true, communes: result.communes }, { status: 200 });
  }
  const status = result.code === "not_found" ? 404 : 502;
  return NextResponse.json({ ok: false, code: result.code }, { status });
}

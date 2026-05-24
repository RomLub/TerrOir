import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeRateLimit, getGeocodeRateLimit } from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import { verifySiret } from "@/lib/sirene/verify-siret";

// POST /api/public/siret/verify — body { siret }
// Confirme l'existence d'un SIRET dans l'annuaire public des entreprises
// (recherche-entreprises.api.gouv.fr) et renvoie le nom légal. NON bloquant
// côté UX : sert d'aide à la saisie + recoupement admin. Rate-limit IP réutilisé
// du géocodeur (même classe : appel d'API gouv externe).

const bodySchema = z.object({
  siret: z.string().trim().regex(/^\d{14}$/),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "invalid_format" }, { status: 400 });
  }

  const { ipAddress } = extractRequestContext(request.headers);
  const rl = await consumeRateLimit(getGeocodeRateLimit(), ipAddress ?? "anon-no-ip");
  if (!rl.success) {
    console.warn(`[SIRET_VERIFY_RATE_LIMIT] ip=${ipAddress ?? "(none)"}`);
    return NextResponse.json({ ok: false, code: "rate_limited" }, { status: 429 });
  }

  const result = await verifySiret(parsed.data.siret);
  if (result.ok) {
    return NextResponse.json(
      result.found
        ? {
            ok: true,
            found: true,
            legalName: result.legalName,
            formeJuridique: result.formeJuridique,
          }
        : { ok: true, found: false },
      { status: 200 },
    );
  }
  return NextResponse.json({ ok: false, code: result.code }, { status: 502 });
}

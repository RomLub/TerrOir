import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

// T-423 : comparaison constant-time pour éliminer le vecteur théorique
// d'attaque par timing sur CRON_SECRET. Aligné avec le pattern déjà utilisé
// dans lib/rgpd/opt-out-token.ts (chantier RGPD avril 2026).
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Vérifie le header `Authorization: Bearer <CRON_SECRET>`.
// Retourne null si OK, sinon un NextResponse 401/500 prêt à renvoyer.
export function assertCronAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

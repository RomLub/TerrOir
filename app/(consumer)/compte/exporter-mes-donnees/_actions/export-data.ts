"use server";

// =============================================================================
// Server action exportMyDataAction (RGPD art. 20 portabilité user-side)
// =============================================================================
// F-011 audit pré-launch 2026-05-10. Construit un zip contenant les données
// personnelles de l'user authentifié et le retourne en base64 au client qui
// déclenche le download via Blob.
//
// Sécurité :
//   - Auth obligatoire (getSessionUser, fail-closed null → erreur)
//   - Rate-limit 5/24h keying userId (Upstash)
//   - Aucun arg user_id côté client : on consomme exclusivement session.id
//     côté serveur. Impossible pour un user de demander l'export d'un autre.
//   - Audit log user_data_exported avec counts (sans PII) systématiquement
//     émis post-build (succès uniquement).
// =============================================================================

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import {
  consumeRateLimit,
  getRgpdExportRateLimit,
} from "@/lib/rate-limit";
import {
  buildExportPayload,
  buildExportZip,
  buildExportFilename,
} from "@/lib/rgpd/export-user-data";

export type ExportMyDataResult =
  | {
      ok: true;
      filename: string;
      base64: string;
    }
  | {
      ok: false;
      error: "unauthorized" | "rate_limited" | "technical";
      retryAfterSeconds?: number;
    };

export async function exportMyDataAction(): Promise<ExportMyDataResult> {
  const session = await getSessionUser();
  if (!session) {
    return { ok: false, error: "unauthorized" };
  }

  // Rate-limit avant tout coût DB. Identifier = userId pour défier NAT-collision
  // et pour aligner avec doctrine getStripeRefundRateLimit / exportComptaLimiter.
  const limiter = getRgpdExportRateLimit();
  const rl = await consumeRateLimit(limiter, `user:${session.id}`);
  if (!rl.success) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((rl.reset - Date.now()) / 1000),
    );
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: session.id,
      metadata: {
        route: "exporter_mes_donnees",
        cap: rl.limit,
        reset: rl.reset,
      },
    });
    return { ok: false, error: "rate_limited", retryAfterSeconds };
  }

  try {
    const admin = createSupabaseAdminClient();
    const payload = await buildExportPayload(admin, session.id);
    const zip = await buildExportZip(payload);
    const filename = buildExportFilename(session.id);

    // Audit log avec counts sans PII pour traçabilité forensique sans stocker
    // d'info personnelle dans metadata (cohérent doctrine T-200 r1).
    await logAuthEvent({
      eventType: "user_data_exported",
      userId: session.id,
      metadata: {
        commandes_count: payload.commandes.length,
        articles_count: payload.articles_commandes.length,
        avis_count: payload.avis.length,
        notifications_count: payload.notifications.length,
        interets_producteurs_count: payload.interets_producteurs.length,
        zip_bytes: zip.length,
      },
    });

    // Conversion uint8array → base64 pour transport server action (Next.js
    // server actions ne supportent pas le retour binaire direct).
    const base64 = Buffer.from(zip).toString("base64");

    return { ok: true, filename, base64 };
  } catch (err) {
    console.error(
      `[RGPD_EXPORT_ERROR] user=${session.id} message=${(err as Error).message}`,
    );
    return { ok: false, error: "technical" };
  }
}


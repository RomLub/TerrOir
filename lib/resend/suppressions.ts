import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { maskEmail } from "@/lib/rgpd/mask-email";

// Audit Email H-3 + M-5 (2026-05-05) — helpers suppression list email.
//
// Sources :
//   - Migration 20260505600000_audit_email_h3_m5_email_suppressions.sql.
//   - Skill list-management.md : « Always check suppression before sending:
//     `if (!await canSendTo(to)) { return { skipped: true }; }` ».
//
// Sémantique :
//   - canSendTo(email) : SELECT 1 FROM email_suppressions WHERE email = ?.
//     Retourne false si trouvé → caller skip l'envoi. Failover ouvert (any
//     erreur DB → return true) : volontaire, on préfère envoyer un email
//     potentiellement vers une adresse suppressed plutôt que bloquer un OTP
//     ou une confirmation commande à cause d'un glitch DB. La table est
//     une optimisation de réputation, pas un mécanisme de sécurité.
//
//   - addSuppression(email, reason, sourceResendId?) : UPSERT (PK email).
//     Si la row existe déjà, on UPDATE reason+source_resend_id+updated_at.
//     Pas de protection contre downgrade (complained → hard_bounce, etc.) :
//     les 3 reasons sont équivalentes en sévérité (tous interdisent l'envoi),
//     la dernière reason vue est la plus pertinente forensiquement.
//
//   - incrementSoftBounce(email, sourceResendId) : INSERT or UPDATE
//     soft_bounce_count++. Si count >= SOFT_BOUNCE_THRESHOLD (3), bascule
//     reason='soft_bounce_threshold' (skill list-management : « 3 soft
//     bounces consecutifs → suppress »).
//
// Normalisation : email lowercase + trim avant SELECT/INSERT. Évite les
// faux négatifs sur 'User@Example.com' vs 'user@example.com' (les RFC
// disent que la part locale est case-sensitive en théorie, mais 99.9% des
// MTA le traitent insensitive — Resend signe ses webhooks avec lowercase).
//
// Pas de masking PII en INSERT : la colonne email est en clair (volontaire,
// PK + clé business). Logs applicatifs masqués via maskEmail().

const SOFT_BOUNCE_THRESHOLD = 3;

export type SuppressionReason =
  | "hard_bounce"
  | "soft_bounce_threshold"
  | "soft_bounce_pending"
  | "complained"
  | "manual";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Reasons qui doivent BLOQUER l'envoi. 'soft_bounce_pending' n'en fait pas
// partie : c'est un staging counter (1 ou 2 soft bounces) qui ne devient
// 'soft_bounce_threshold' qu'à partir de 3 (cf SOFT_BOUNCE_THRESHOLD).
const BLOCKING_REASONS: ReadonlySet<SuppressionReason> = new Set([
  "hard_bounce",
  "complained",
  "soft_bounce_threshold",
  "manual",
]);

export async function canSendTo(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return true;

  try {
    const admin = createSupabaseAdminClient();
    // T-110 : .ilike() pour case-insensitive defense-in-depth (cf. doctrine
    // docs/fixes/email-lookup-ilike-2026-05-06.md).
    const { data, error } = await admin
      .from("email_suppressions")
      .select("reason")
      .ilike("email", normalized)
      .maybeSingle();

    if (error) {
      console.warn(
        `[EMAIL_SUPPRESSIONS_READ_WARN] email=${maskEmail(email)} error=${error.message}`,
      );
      return true;
    }

    if (!data) return true;
    return !BLOCKING_REASONS.has(data.reason as SuppressionReason);
  } catch (err) {
    console.warn(
      `[EMAIL_SUPPRESSIONS_READ_WARN] email=${maskEmail(email)} error=${(err as Error).message}`,
    );
    return true;
  }
}

export async function addSuppression(
  email: string,
  reason: SuppressionReason,
  sourceResendId?: string | null,
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("email_suppressions").upsert(
    {
      email: normalized,
      reason,
      source_resend_id: sourceResendId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );

  if (error) {
    console.error(
      `[EMAIL_SUPPRESSIONS_UPSERT_ERR] email=${maskEmail(email)} reason=${reason} error=${error.message}`,
    );
    throw new Error(`email_suppressions upsert failed: ${error.message}`);
  }
}

export async function incrementSoftBounce(
  email: string,
  sourceResendId?: string | null,
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const admin = createSupabaseAdminClient();

  // T-110 : .ilike() pour case-insensitive defense-in-depth.
  const { data: existing, error: readErr } = await admin
    .from("email_suppressions")
    .select("email, reason, soft_bounce_count")
    .ilike("email", normalized)
    .maybeSingle();

  if (readErr) {
    console.error(
      `[EMAIL_SUPPRESSIONS_READ_ERR] email=${maskEmail(email)} error=${readErr.message}`,
    );
    throw new Error(`email_suppressions read failed: ${readErr.message}`);
  }

  // Déjà suppressed pour autre cause (hard_bounce / complained /
  // soft_bounce_threshold / manual) : envoi déjà bloqué par canSendTo.
  // No-op : pas la peine d'incrémenter, on ne va pas en sortir.
  if (
    existing &&
    existing.reason !== "soft_bounce_pending"
  ) {
    return;
  }

  const nextCount = (existing?.soft_bounce_count ?? 0) + 1;
  const reachedThreshold = nextCount >= SOFT_BOUNCE_THRESHOLD;

  const { error: upsertErr } = await admin.from("email_suppressions").upsert(
    {
      email: normalized,
      // Avant le seuil : 'soft_bounce_pending' (staging counter, n'active
      // PAS canSendTo=false — cf BLOCKING_REASONS). Au seuil franchi :
      // bascule 'soft_bounce_threshold' qui bloque les sends futurs.
      reason: reachedThreshold ? "soft_bounce_threshold" : "soft_bounce_pending",
      soft_bounce_count: nextCount,
      source_resend_id: sourceResendId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );

  if (upsertErr) {
    console.error(
      `[EMAIL_SUPPRESSIONS_UPSERT_ERR] email=${maskEmail(email)} count=${nextCount} error=${upsertErr.message}`,
    );
    throw new Error(`email_suppressions upsert failed: ${upsertErr.message}`);
  }
}

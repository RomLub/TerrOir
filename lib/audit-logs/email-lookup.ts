import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// T-083 — Lookup email → user_id pour le filtre /admin/audit-logs avec
// garantie anti-énumération.
//
// Stratégie (variante b retenue, cf. plan T-080) :
//   1. Normalise l'email (trim + toLowerCase) côté serveur.
//   2. Lookup auth.users.email via service_role (bypass RLS).
//   3. Email trouvé   → renvoie le user_id réel.
//      Email inconnu  → renvoie un UUID sentinel impossible.
//   4. Le caller filtre audit_logs par user_id sans distinction de cas
//      (UI uniforme : 0 résultat = pas d'oracle "email existe / n'existe
//      pas").
//
// Pourquoi pas client-side hash + comparison server-side : exigerait un
// users.email_hash column (migration) ou un scan O(n) de auth.users en
// hashant chaque row. Trade-off : la version actuelle stocke l'email en
// clair côté request body / Vercel logs — acceptable car (a) l'admin a
// déjà /gestion-producteurs comme oracle email-by-design, (b) la route
// est rate-limitée 30/min/admin (cf. lib/rate-limit.ts), (c) on émet un
// audit log meta `admin_audit_logs_email_lookup` à chaque appel pour
// détection forensique d'abus.
//
// SENTINEL_NOT_FOUND_USER_ID : choisi all-zero pour être visuellement
// distinguable d'un vrai user_id et garanti absent en DB (gen_random_uuid
// ne génère jamais cette valeur). Filtre audit_logs.user_id = sentinel
// retourne toujours 0 rows → réponse uniforme.

export const SENTINEL_NOT_FOUND_USER_ID =
  "00000000-0000-0000-0000-000000000000";

// Masque un email pour traçabilité forensique sans tout déballer en clair :
//   "lubin.rom@gmail.com" → "l***@gmail.com"
//   "a@b.fr"              → "a***@b.fr"
//   "ab"                  → "***" (input dégénéré)
// Préserve le domaine pour permettre la corrélation entre events sans
// reconstituer l'identité user. Utilisé par l'audit log meta
// 'admin_audit_logs_email_lookup' (cf. log-legal-event.ts).
export function maskEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return "***";
  const localFirst = trimmed[0]!;
  const domain = trimmed.slice(at + 1);
  return `${localFirst}***@${domain}`;
}

export type EmailLookupResult = {
  // user_id réel si trouvé, sinon SENTINEL_NOT_FOUND_USER_ID. Le caller
  // ne doit JAMAIS exposer la distinction côté UI.
  userId: string;
  // Sert uniquement aux call sites internes (test, audit log meta).
  // L'UI ne doit pas conditionner son rendu sur `found`.
  found: boolean;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > 320) return null; // RFC 5321 max email length
  if (!EMAIL_REGEX.test(trimmed)) return null;
  return trimmed;
}

export async function lookupUserIdByEmail(
  email: string,
): Promise<EmailLookupResult> {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { userId: SENTINEL_NOT_FOUND_USER_ID, found: false };
  }
  const admin = createSupabaseAdminClient();
  // auth.admin.listUsers ne filtre pas par email — on passe par la table
  // public.users qui mirror auth.users(id, email) via trigger applicatif
  // (cf. migrations users — colonne email maintenue côté projet TerrOir).
  // T-110 : .ilike() pour case-insensitive defense-in-depth. `normalized` est
  // déjà lowercase via normalizeEmail(), mais la table peut contenir des emails
  // en casse mixte (legacy avant doctrine T-110, mirror auth.users non normalisé).
  const { data, error } = await admin
    .from("users")
    .select("id")
    .ilike("email", normalized)
    .maybeSingle();
  if (error || !data?.id) {
    return { userId: SENTINEL_NOT_FOUND_USER_ID, found: false };
  }
  return { userId: data.id as string, found: true };
}

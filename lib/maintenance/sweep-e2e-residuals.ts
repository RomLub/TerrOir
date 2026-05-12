/**
 * lib/maintenance/sweep-e2e-residuals.ts
 *
 * Sweep défensif des résiduels E2E (sentinel `playwright-test-*@mailinator.com`).
 *
 * Module canonique partagé entre :
 *   1. Playwright lifecycle (`tests/e2e/setup/global-setup.ts` + `global-teardown.ts`)
 *      → exécuté en Node pur tsx (hors Next.js runtime).
 *   2. Route cron prod (`app/api/cron/cleanup-test-residuals/route.ts`)
 *      → exécuté en Next.js Vercel runtime.
 *   3. Script CLI standalone (`scripts/cleanup-test-residuals-e2e.ts`)
 *      → exécuté en tsx local pour debug/manuel.
 *
 * Note client Supabase : on instancie un admin client inline (pas via
 * `lib/supabase/admin.ts` canonique) pour éviter `import "server-only"` qui
 * plante côté Playwright Node tsx. Les env vars consommées sont identiques.
 *
 * Stratégie : préfixe email allow-list `playwright-test-*@mailinator.com`
 * (cf. `tests/e2e/helpers/guards.ts:70` `generateTestEmail`) + filtre
 * `createdAt > N heures` pour ne pas supprimer les users d'un autre run en
 * cours simultané.
 *
 * Idempotent — peut être appelé sans risque, ne touche que les rows matchant
 * le pattern allow-list e2e.
 *
 * Cf. doctrine `docs/conventions/regression-tests-security.md` (E2E sentinel
 * + cleanup, section pattern doctrine).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SweepOptions {
  /** Ne supprime que les users plus vieux que N heures. Default 6h. */
  minAgeHours?: number;
  /** Si true, ne touche rien et retourne juste les counts. Default false. */
  dryRun?: boolean;
}

export interface SweepResult {
  authUsersDeleted: number;
  testEmailsDeleted: number;
  errors: string[];
}

const DEFAULT_MIN_AGE_HOURS = 6;
const ALLOW_PATTERN_LIKE = "playwright-test-%@mailinator.com";

function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL manquant");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function sweepE2EResiduals(
  options: SweepOptions = {},
): Promise<SweepResult> {
  const minAgeHours = options.minAgeHours ?? DEFAULT_MIN_AGE_HOURS;
  const dryRun = options.dryRun ?? false;
  const admin = getAdminClient();

  const errors: string[] = [];
  let authUsersDeleted = 0;
  let testEmailsDeleted = 0;

  // 1. test_emails_captured : purge complète des rows playwright-test-*
  //    (la table est dédiée e2e, pas de PII risk).
  try {
    const { data: emailsToPurge, error } = await admin
      .from("test_emails_captured")
      .select("id")
      .like("to_email", ALLOW_PATTERN_LIKE);
    if (error) {
      errors.push(`test_emails_captured select: ${error.message}`);
    } else if (emailsToPurge && emailsToPurge.length > 0 && !dryRun) {
      const ids = emailsToPurge.map((r) => r.id as string);
      const { error: delErr } = await admin
        .from("test_emails_captured")
        .delete()
        .in("id", ids);
      if (delErr) {
        errors.push(`test_emails_captured delete: ${delErr.message}`);
      } else {
        testEmailsDeleted = ids.length;
      }
    } else {
      testEmailsDeleted = emailsToPurge?.length ?? 0;
    }
  } catch (err) {
    errors.push(`test_emails_captured exception: ${(err as Error).message}`);
  }

  // 2. auth.users avec préfixe playwright-test-* : list + filter par age + delete.
  //    auth.admin.listUsers ne supporte pas un LIKE direct, on filtre côté JS.
  //    perPage=1000 suffit largement (sweep défensif, pas un cas hot path).
  try {
    const cutoffMs = Date.now() - minAgeHours * 3600 * 1000;
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) {
      errors.push(`auth.admin.listUsers: ${error.message}`);
    } else {
      const candidates = (data?.users ?? []).filter((u) => {
        if (!u.email) return false;
        if (
          !u.email.startsWith("playwright-test-") ||
          !u.email.endsWith("@mailinator.com")
        ) {
          return false;
        }
        const created = new Date(u.created_at).getTime();
        return created < cutoffMs;
      });
      for (const u of candidates) {
        if (dryRun) {
          authUsersDeleted += 1;
          continue;
        }
        try {
          // Purge orderés AVANT auth.admin.deleteUser (FK NO ACTION sur producers,
          // orders, etc. — sinon delete user fail).
          await admin.from("producers").delete().eq("user_id", u.id);
          await admin.from("orders").delete().eq("consumer_id", u.id);
          // public.users CASCADE depuis auth.users.id, donc inutile manuellement
          // mais on reste défensif si la CASCADE a été désactivée par migration future.
          await admin.from("users").delete().eq("id", u.id);
          const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
          if (delErr) {
            errors.push(`auth.admin.deleteUser ${u.id}: ${delErr.message}`);
          } else {
            authUsersDeleted += 1;
          }
        } catch (err) {
          errors.push(`auth user ${u.id} sweep: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    errors.push(`auth users sweep exception: ${(err as Error).message}`);
  }

  return { authUsersDeleted, testEmailsDeleted, errors };
}

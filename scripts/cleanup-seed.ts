/**
 * Suppression en cascade des producteurs fictifs seedés via seed-producers.ts.
 *
 * Cible : tous les users dont l'email se termine par @seed.terroir-local.fr.
 *
 * Ordre de suppression :
 *   1. products (CASCADE via producer_id, donc implicite à l'étape 2)
 *   2. producers WHERE user_id IN (seed ids)
 *   3. auth.users (CASCADE vers public.users via FK)
 *
 * Idempotent : relançable sans erreur même si la base est déjà nettoyée.
 *
 * Usage :
 *   npx tsx scripts/cleanup-seed.ts --dry-run
 *   npx tsx scripts/cleanup-seed.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import readline from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { maskEmail } from "@/lib/rgpd/mask-email";

// Charge .env.local depuis la racine du repo AVANT toute lecture process.env.
// Ergonomie Windows PowerShell — pas besoin de sourcer manuellement.
loadEnv({ path: resolve(process.cwd(), ".env.local") });

const DRY_RUN = process.argv.includes("--dry-run");
const EMAIL_SUFFIX = "@seed.terroir-local.fr";
const EMAIL_PATTERN = `%${EMAIL_SUFFIX}`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Manque NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAuthSeedUsers(): Promise<Array<{ id: string; email: string }>> {
  // Parcourt toutes les pages pour couvrir même si d'anciens seeds traînent.
  const found: Array<{ id: string; email: string }> = [];
  const perPage = 200;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers p${page}: ${error.message}`);
    for (const u of data.users) {
      if (u.email?.toLowerCase().endsWith(EMAIL_SUFFIX.toLowerCase())) {
        found.push({ id: u.id, email: u.email });
      }
    }
    if (data.users.length < perPage) break;
  }
  return found;
}

async function confirm(count: number): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `\n⚠️  Connexion à ${SUPABASE_URL}\n   ${count} user(s) @seed.terroir-local.fr vont être SUPPRIMÉS (cascade).\n   Continuer ? (y/N) `,
  );
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log(`Supabase : ${SUPABASE_URL}`);
  console.log(`Mode     : ${DRY_RUN ? "DRY-RUN (aucune écriture)" : "SUPPRESSION RÉELLE"}`);
  console.log(`Pattern  : email LIKE '${EMAIL_PATTERN}'`);
  console.log("=".repeat(70));

  const authUsers = await listAuthSeedUsers();
  console.log(`\nTrouvés dans auth.users : ${authUsers.length}`);
  for (const u of authUsers) console.log(`  - ${maskEmail(u.email)} (${u.id})`);

  if (authUsers.length === 0) {
    console.log("\nRien à supprimer.");
    return;
  }

  const ids = authUsers.map((u) => u.id);

  // Preview : producers + products concernés
  const { data: producers } = await admin
    .from("producers")
    .select("id, slug, user_id")
    .in("user_id", ids);
  console.log(`\nProducers ciblés : ${producers?.length ?? 0}`);
  for (const p of producers ?? []) console.log(`  - ${p.slug} (${p.id})`);

  const producerIds = (producers ?? []).map((p) => p.id as string);
  let productsCount = 0;
  if (producerIds.length > 0) {
    const { count } = await admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .in("producer_id", producerIds);
    productsCount = count ?? 0;
  }
  console.log(`Products ciblés : ${productsCount} (cascade via producer_id)`);

  if (!DRY_RUN) {
    const ok = await confirm(authUsers.length);
    if (!ok) {
      console.log("Annulé.");
      process.exit(0);
    }
  }

  // 1. Delete producers (cascade products/slots/orders via FK ON DELETE CASCADE)
  if (producerIds.length > 0) {
    console.log(`\n[1/2] Suppression producers (${producerIds.length})…`);
    if (!DRY_RUN) {
      const { error } = await admin.from("producers").delete().in("id", producerIds);
      if (error) throw new Error(`producers delete: ${error.message}`);
    }
  }

  // 2. Delete auth.users → cascade public.users via FK
  console.log(`\n[2/2] Suppression auth.users (${ids.length})…`);
  for (const u of authUsers) {
    console.log(`  - ${maskEmail(u.email)}`);
    if (!DRY_RUN) {
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) throw new Error(`deleteUser ${maskEmail(u.email)}: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`✓ Nettoyé : ${authUsers.length} users · ${producerIds.length} producers · ${productsCount} products`);
  if (DRY_RUN) console.log("  (dry-run, rien n'a été supprimé)");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("\n✗ Erreur :", err);
  process.exit(1);
});

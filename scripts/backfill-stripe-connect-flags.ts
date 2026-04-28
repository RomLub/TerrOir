/**
 * Backfill one-shot des flags Stripe Connect sur producers.
 *
 * Contexte : le webhook account.updated (commit de4a2cd) synchronise
 * stripe_charges_enabled / stripe_payouts_enabled / stripe_details_submitted
 * sur producers à chaque event Stripe. Mais Stripe ne re-émet PAS spontanément
 * account.updated pour les comptes Connect existants — donc tous les
 * producers onboardés AVANT le 24/04 (date de livraison du handler) ont les
 * 3 flags figés à false (default migration 20260424000000) jusqu'au prochain
 * event naturel (re-onboarding manuel, capability change…).
 *
 * Ce script lit producers.stripe_account_id, fetch chaque Stripe.Account via
 * stripe.accounts.retrieve(), et UPDATE les 3 flags via syncStripeAccountFlags
 * (même fonction que le webhook live → cohérence garantie).
 *
 * Usage :
 *   npx tsx scripts/backfill-stripe-connect-flags.ts                # dry-run par défaut
 *   npx tsx scripts/backfill-stripe-connect-flags.ts --apply        # écrit en base
 *
 * Variables d'env requises (source .env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY
 *
 * Skip volontaire :
 *   - producers.statut = 'deleted' (anonymisés RGPD : delete_user_account
 *     remet déjà les 3 flags à false, cohérent — pas de resync à tenter).
 *   - account introuvable côté Stripe (StripeError code 'account_invalid'
 *     ou 'resource_missing') : log warn + skip, on ne touche PAS les flags
 *     DB pour préserver la trace.
 *
 * Rate limiting : sleep 100ms entre chaque appel stripe.accounts.retrieve.
 * Stripe rate limit standard = 100 req/s, on reste très en dessous.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import { resolve } from "node:path";
import { syncStripeAccountFlags } from "@/lib/stripe/sync-account-flags";

// Charge .env.local depuis la racine du repo AVANT toute lecture process.env.
// Ergonomie Windows PowerShell — pas besoin de sourcer manuellement.
loadEnv({ path: resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
  console.error(
    "Manque NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou STRIPE_SECRET_KEY. " +
      "Source .env.local avant de lancer le script.",
  );
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
  typescript: true,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ProducerRow = {
  id: string;
  stripe_account_id: string;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  statut: string;
};

async function main() {
  console.log(
    `[BACKFILL] mode=${APPLY ? "APPLY" : "DRY-RUN"} — ${APPLY ? "ÉCRITURES RÉELLES" : "aucune écriture"}`,
  );

  // Skip 'deleted' (RGPD anonymisé) côté requête : delete_user_account
  // remet stripe_account_id à null, donc le filter NOT NULL suffit en
  // théorie, mais on double-belt avec .neq('statut', 'deleted') au cas
  // où un compte deleted serait dans un état partiel.
  const { data: producers, error } = await admin
    .from("producers")
    .select(
      "id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, statut",
    )
    .not("stripe_account_id", "is", null)
    .neq("statut", "deleted");

  if (error) {
    console.error("[BACKFILL] erreur SELECT producers :", error.message);
    process.exit(1);
  }

  const rows = (producers ?? []) as ProducerRow[];
  console.log(`[BACKFILL] ${rows.length} producer(s) à traiter`);

  let updates = 0;
  let unchanged = 0;
  let stripeNotFound = 0;
  let errors = 0;

  for (const p of rows) {
    try {
      const account = await stripe.accounts.retrieve(p.stripe_account_id);

      const beforeFlags = {
        charges: p.stripe_charges_enabled,
        payouts: p.stripe_payouts_enabled,
        details: p.stripe_details_submitted,
      };
      const afterFlags = {
        charges: !!account.charges_enabled,
        payouts: !!account.payouts_enabled,
        details: !!account.details_submitted,
      };
      const same =
        beforeFlags.charges === afterFlags.charges &&
        beforeFlags.payouts === afterFlags.payouts &&
        beforeFlags.details === afterFlags.details;

      if (same) {
        unchanged += 1;
        console.log(
          `[BACKFILL] producer=${p.id} account=${p.stripe_account_id} no change (charges=${afterFlags.charges} payouts=${afterFlags.payouts} details=${afterFlags.details})`,
        );
      } else {
        const transition = `charges ${beforeFlags.charges}→${afterFlags.charges}, payouts ${beforeFlags.payouts}→${afterFlags.payouts}, details ${beforeFlags.details}→${afterFlags.details}`;

        if (!APPLY) {
          console.log(
            `[DRY] would update producer=${p.id} account=${p.stripe_account_id} (${transition})`,
          );
          updates += 1;
        } else {
          const result = await syncStripeAccountFlags(account, admin);
          if (result.updated) {
            updates += 1;
            console.log(
              `[BACKFILL] producer=${p.id} account=${p.stripe_account_id} updated (${transition})`,
            );
          } else {
            errors += 1;
            console.warn(
              `[BACKFILL] producer=${p.id} account=${p.stripe_account_id} sync returned updated=false (déjà raced ou row mismatch)`,
            );
          }
        }
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      // Stripe retourne 'resource_missing' ou 'account_invalid' si l'id pointe
      // sur un compte deleted/inexistant (ex. compte Connect supprimé manuellement
      // côté Dashboard sans nettoyage DB).
      if (e.code === "resource_missing" || e.code === "account_invalid") {
        stripeNotFound += 1;
        console.warn(
          `[BACKFILL] producer=${p.id} account=${p.stripe_account_id} introuvable côté Stripe (${e.code}) — skip, flags DB conservés`,
        );
      } else {
        errors += 1;
        console.error(
          `[BACKFILL] producer=${p.id} account=${p.stripe_account_id} erreur ${e.code ?? "unknown"}: ${e.message ?? "no message"}`,
        );
      }
    }

    // Stripe rate limit standard = 100 req/s. 100ms entre chaque appel
    // garantit un large marge même avec quelques retries internes du SDK.
    await sleep(100);
  }

  console.log("");
  console.log("=== RÉCAP ===");
  console.log(`mode             : ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`producers traités: ${rows.length}`);
  console.log(`updates          : ${updates}${APPLY ? "" : " (simulés)"}`);
  console.log(`déjà alignés     : ${unchanged}`);
  console.log(`Stripe 404       : ${stripeNotFound}`);
  console.log(`erreurs          : ${errors}`);

  if (!APPLY && updates > 0) {
    console.log("");
    console.log(
      "Pour appliquer ces updates : npx tsx scripts/backfill-stripe-connect-flags.ts --apply",
    );
  }
}

main().catch((err) => {
  console.error("[BACKFILL] échec fatal :", err);
  process.exit(1);
});

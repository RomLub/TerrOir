/**
 * T-439 audit/cleanup Customers Stripe orphelins.
 *
 * Contexte : avant T-432 mergé (#69 race anti-orphelin
 * getOrCreateStripeCustomer), une race entre stripe.customers.create() et
 * UPDATE users.stripe_customer_id pouvait laisser des Customers Stripe
 * orphelins (créés Stripe-side mais pas persistés DB-side). Post-T-432,
 * l'idempotency-key `customer_create_${userId}` garantit que 2 calls
 * concurrents reçoivent le MÊME customer.id, donc plus de nouveaux orphelins.
 * Mais les Customers déjà créés AVANT T-432 mergé peuvent rester orphelins.
 *
 * Ce script identifie ces orphelins en parcourant les Customers Stripe
 * (pagination via stripe.customers.list) et vérifiant l'absence de
 * correspondance dans users.stripe_customer_id.
 *
 * ⚠️ EXCEPTION pattern projet : rupture de la convention "DB-driven jamais
 * stripe.customers.list" (cohérent T-419 backfill + T-441 audit PMs orphelins
 * où stripe.customers.list n'apparait nulle part dans le repo). Trouver les
 * orphelins purs Stripe est mathématiquement impossible côté DB pure : si un
 * Customer existe Stripe-side sans entrée DB users.stripe_customer_id, aucune
 * itération DB-driven ne peut le découvrir. Cette rupture est strictement
 * scope-justifiée et ne s'applique qu'à T-439.
 *
 * Algorithme :
 *  1. Iterate Customers Stripe via stripe.customers.list paginé
 *     (starting_after pour pagination, has_more pour terminaison).
 *  2. Pour chaque Customer :
 *     a. Skip si customer.deleted (RGPD anonymisé déjà fait côté Stripe).
 *     b. Skip si customer.created < 24h (anti-race en cours, jitter
 *        persistence DB possible même post-T-432).
 *     c. Check correspondance DB via users.stripe_customer_id = customer.id.
 *     d. Si match → customersWithDbMatch++, return (pas orphelin).
 *     e. Sinon → check metadata.user_id cross-DB (cas legacy bug : Customer
 *        avec metadata pointant vers user existant mais users.stripe_customer_id
 *        désynchro). Log warn + skip pour intervention manuelle Romain.
 *     f. Sinon → orphelin candidat → garde-fou stripe.charges.list empty.
 *     g. Si charges.length > 0 → orphansWithCharges++, log warn,
 *        NE PAS delete (préserver historique transaction).
 *     h. Si charges.length === 0 → orphelin confirmé.
 *  3. Mode dry-run par défaut : print rapport structuré.
 *  4. Mode --apply : stripe.customers.del(orphan.id) si charges empty.
 *
 * Garde-fous critiques :
 *  - Skip customer.deleted (RGPD)
 *  - Skip created < 24h (anti-race en cours)
 *  - Garde-fou charges.list empty obligatoire avant delete (action majeure :
 *    delete Customer Stripe = perte définitive du Customer côté Stripe)
 *  - Sleep 100ms entre Customers (rate limit Stripe ~100 req/s)
 *  - Sleep 100ms entre pages pagination (idem)
 *  - Pagination starting_after pour gérer >100 Customers
 *  - Skip metadata.user_id matchant user DB existant (bug legacy non
 *    automatisable, intervention manuelle requise)
 *
 * Note env Live vs Test :
 *  - Actuellement STRIPE_SECRET_KEY = sk_test_* (env Test, pré-T-002)
 *  - Post-T-002 (bascule Stripe Test → Live), ré-exécuter le script en
 *    env Live (.env.local switch sk_live_*) pour audit/cleanup prod.
 *  - Le script log son env (TEST/LIVE) au démarrage pour éviter toute
 *    confusion opérationnelle.
 *
 * Usage :
 *   npx tsx scripts/audit-cleanup-orphan-customers.ts                    # dry-run
 *   npx tsx scripts/audit-cleanup-orphan-customers.ts --apply            # commit delete
 *
 * Variables d'env requises (source .env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY
 *
 * Pattern aligné scripts/audit-cleanup-orphan-pms.ts (T-441 #79 référence
 * directe) + scripts/backfill-stripe-connect-flags.ts (T-419 historique).
 *
 * Couplage T-432 #69 (race anti-orphelin getOrCreateStripeCustomer) +
 *           T-441 #79 (script audit/cleanup PMs orphelins, pattern référence) +
 *           T-419 (pattern backfill original).
 *
 * T-453 (post-T-439 reflag) : skip Merchants Connect v2 via combo défensif
 *  A) Pre-flight metadata.user_id heuristique (Customers consumers TerrOir
 *     ont TOUJOURS metadata.user_id set depuis 1er commit lib/stripe/customer.ts
 *     7992727 ; absence → candidat Merchant Connect v2 auto-créé Stripe).
 *  B) Post-delete error catch substring match "linked to a v2 Account" /
 *     "v2/core/accounts" → reclassifier en customersConnectMerchantSkip
 *     plutôt que orphansDeleteFailed (autorité Stripe-side authoritative).
 *  Trace : faux positif cus_UMfaaMmcCd9BHP détecté en smoke Test 30/04/2026.
 *  SDK Stripe typé v18 acacia 2025-02-24 ne discrimine PAS Customer simple
 *  vs Merchant Connect v2 via field public — heuristique + substring match
 *  sont les seuls patterns sains sans extra API call.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import { resolve } from "node:path";

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type Counters = {
  customersScanned: number;
  customersStripeDeleted: number;
  customersTooRecent: number;
  customersWithDbMatch: number;
  customersWithMetadataMatch: number;
  customersConnectMerchantSkip: number;
  orphansDetected: number;
  orphansWithCharges: number;
  orphansDeleted: number;
  orphansDeleteFailed: number;
  customerErrors: number;
};

async function main() {
  const env = STRIPE_SECRET_KEY?.startsWith("sk_test_") ? "TEST" : "LIVE";
  console.log(
    `[T-439] mode=${APPLY ? "APPLY" : "DRY-RUN"} stripe_env=${env} — ${
      APPLY ? "DELETE RÉEL" : "aucune écriture"
    }`,
  );
  console.log("");

  const counters: Counters = {
    customersScanned: 0,
    customersStripeDeleted: 0,
    customersTooRecent: 0,
    customersWithDbMatch: 0,
    customersWithMetadataMatch: 0,
    customersConnectMerchantSkip: 0,
    orphansDetected: 0,
    orphansWithCharges: 0,
    orphansDeleted: 0,
    orphansDeleteFailed: 0,
    customerErrors: 0,
  };

  // Pagination Stripe customers.list. starting_after référence le dernier
  // customer.id de la page précédente. has_more=false → fin pagination.
  let startingAfter: string | undefined = undefined;
  let pageCount = 0;
  while (true) {
    pageCount += 1;
    const page: Stripe.ApiList<Stripe.Customer> = await stripe.customers.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    if (pageCount === 1 && page.data.length === 0) {
      console.log("[T-439] aucun customer Stripe à scanner");
      break;
    }

    for (const customer of page.data) {
      counters.customersScanned += 1;
      await processStripeCustomer(customer, counters);
      // Stripe rate limit standard = 100 req/s. 100ms entre chaque customer
      // garantit large marge même avec quelques retries internes du SDK.
      await sleep(100);
    }

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
    // Pause entre pages pour respirer (la pagination en soi peut ramener
    // 100 customers * 2-3 calls API chacun = ~300 calls/page).
    await sleep(100);
  }

  console.log("");
  console.log("=== RÉCAP ===");
  console.log(`mode                       : ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`stripe env                 : ${env}`);
  console.log(`pages parcourues           : ${pageCount}`);
  console.log(`customers scannés          : ${counters.customersScanned}`);
  console.log(`customers Stripe deleted   : ${counters.customersStripeDeleted}`);
  console.log(`customers trop récents     : ${counters.customersTooRecent} (skip < 24h)`);
  console.log(`customers avec match DB    : ${counters.customersWithDbMatch}`);
  console.log(`customers metadata match   : ${counters.customersWithMetadataMatch} (intervention manuelle)`);
  console.log(`customers Connect Merchant : ${counters.customersConnectMerchantSkip} (skip safety, v2 Account)`);
  console.log(`orphelins détectés         : ${counters.orphansDetected}`);
  console.log(`orphelins avec charges     : ${counters.orphansWithCharges} (skip safety)`);
  if (APPLY) {
    console.log(`orphelins delete OK        : ${counters.orphansDeleted}`);
    console.log(`orphelins delete FAIL      : ${counters.orphansDeleteFailed}`);
  }
  console.log(`erreurs customer (skip)    : ${counters.customerErrors}`);

  if (!APPLY && counters.orphansDetected > counters.orphansWithCharges) {
    console.log("");
    console.log(
      "Pour delete les orphelins sans charges : npx tsx scripts/audit-cleanup-orphan-customers.ts --apply",
    );
  }
}

async function processStripeCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
  counters: Counters,
): Promise<void> {
  const cid = customer.id;
  try {
    // Skip Customer.deleted (RGPD anonymisé déjà fait côté Stripe).
    // L'API stripe.customers.list peut retourner des Customers deleted dans
    // les anciennes pages de retention (très rare, mais documenté).
    if ("deleted" in customer && customer.deleted) {
      counters.customersStripeDeleted += 1;
      return;
    }

    const cust = customer as Stripe.Customer;

    // Skip created < 24h : anti-race en cours. Même post-T-432, le délai
    // entre stripe.customers.create() et UPDATE users.stripe_customer_id
    // peut atteindre quelques secondes (ou plus si DB sous load). 24h est
    // une fenêtre conservative qui couvre tous les jitters réalistes.
    const ageMs = Date.now() - cust.created * 1000;
    if (ageMs < ONE_DAY_MS) {
      counters.customersTooRecent += 1;
      return;
    }

    // T-453 pre-flight Connect Merchant heuristique : Customers consumers TerrOir
    // ont TOUJOURS metadata.user_id set (lib/stripe/customer.ts:48 depuis 1er
    // commit 7992727). Absence → candidat Merchant Connect v2 auto-créé Stripe
    // (faux positif détecté smoke cus_UMfaaMmcCd9BHP). Skip défensif anti-pollution
    // orphansDetected/orphansDeleteFailed. Rattrapage post-delete (E) couvre les
    // rares cas Dashboard-créés ayant metadata.user_id mais réellement Merchant.
    if (!cust.metadata?.user_id) {
      counters.customersConnectMerchantSkip += 1;
      console.log(
        `[T-453] customer=${cid} email=${cust.email ?? "?"} no metadata.user_id — likely Connect Merchant skip=safety`,
      );
      return;
    }

    // Check correspondance DB via users.stripe_customer_id.
    // Si match → Customer est légitimement attaché à un user, pas orphelin.
    const { data: dbUser, error: dbError } = await admin
      .from("users")
      .select("id")
      .eq("stripe_customer_id", cid)
      .maybeSingle();

    if (dbError) {
      counters.customerErrors += 1;
      console.error(
        `[T-439] customer=${cid} erreur SELECT users : ${dbError.message}`,
      );
      return;
    }

    if (dbUser) {
      counters.customersWithDbMatch += 1;
      return;
    }

    // Check metadata.user_id cross-DB. lib/stripe/customer.ts:48 écrit
    // metadata: { user_id: userId } à la création. Si la metadata pointe
    // vers un user DB existant mais users.stripe_customer_id n'est PAS
    // synchro avec ce Customer, c'est un cas legacy bug : ne PAS auto-delete,
    // intervention manuelle Romain requise (SET stripe_customer_id côté DB).
    const metadataUserId = cust.metadata?.user_id;
    if (metadataUserId) {
      const { data: metaUser, error: metaError } = await admin
        .from("users")
        .select("id, stripe_customer_id")
        .eq("id", metadataUserId)
        .maybeSingle();

      if (metaError) {
        counters.customerErrors += 1;
        console.error(
          `[T-439] customer=${cid} erreur SELECT users metadata : ${metaError.message}`,
        );
        return;
      }

      if (metaUser) {
        counters.customersWithMetadataMatch += 1;
        const dbStripeId = metaUser.stripe_customer_id ?? "null";
        console.warn(
          `[T-439] customer=${cid} email=${cust.email ?? "?"} metadata.user_id=${metadataUserId} matche user DB mais users.stripe_customer_id=${dbStripeId} (désynchro). Action manuelle Romain : décider quel customer.id garder côté DB pour user ${metadataUserId}`,
        );
        return;
      }
    }

    // Orphelin candidat → garde-fou stripe.charges.list empty.
    // limit=1 suffit : on cherche juste à savoir s'il existe AU MOINS 1
    // charge historique. Si oui, ne PAS delete (préserver historique).
    const charges = await stripe.charges.list({
      customer: cid,
      limit: 1,
    });

    counters.orphansDetected += 1;

    if (charges.data.length > 0) {
      counters.orphansWithCharges += 1;
      console.log(
        `[T-439] orphan WITH CHARGES skip=safety customer=${cid} email=${cust.email ?? "?"} created=${new Date(cust.created * 1000).toISOString()} first_charge=${charges.data[0].id}`,
      );
      return;
    }

    // Orphelin confirmé sans charges historiques.
    console.log(
      `[T-439] orphan CONFIRMED customer=${cid} email=${cust.email ?? "?"} created=${new Date(cust.created * 1000).toISOString()} metadata=${JSON.stringify(cust.metadata ?? {})}`,
    );

    if (!APPLY) return;

    try {
      await stripe.customers.del(cid);
      counters.orphansDeleted += 1;
      console.log(`  delete OK ${cid}`);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const msg = err.message ?? "";

      // T-453 rattrapage Connect Merchant post-delete : si Stripe rejette le
      // delete avec message "linked to a v2 Account" / "v2/core/accounts",
      // c'est un Merchant Connect que la pre-flight A (metadata.user_id) a
      // manqué (cas Dashboard-créé ayant metadata.user_id mais lié Connect v2).
      // Reclassifier dans counter dédié plutôt que orphansDeleteFailed pour
      // ne pas masquer les vrais fails (rate limit, network blip).
      if (
        msg.includes("linked to a v2 Account") ||
        msg.includes("v2/core/accounts")
      ) {
        counters.customersConnectMerchantSkip += 1;
        console.warn(
          `  delete SKIP ${cid} Connect Merchant v2 (rattrapage post-delete)`,
        );
      } else {
        counters.orphansDeleteFailed += 1;
        console.warn(
          `  delete FAIL ${cid} (${err.code ?? "unknown"}): ${msg || "no message"}`,
        );
      }
    }
    // Sleep après delete pour respecter rate limit.
    await sleep(100);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // resource_missing : Customer disparu entre stripe.customers.list et
    // les calls suivants (race deletion concurrente Dashboard, très rare).
    if (err.code === "resource_missing") {
      counters.customersStripeDeleted += 1;
      console.warn(
        `[T-439] customer=${cid} stripe resource_missing (race deletion concurrente) skip`,
      );
      return;
    }
    counters.customerErrors += 1;
    console.error(
      `[T-439] customer=${cid} erreur ${err.code ?? "unknown"}: ${err.message ?? "no message"}`,
    );
  }
}

main().catch((err) => {
  console.error("[T-439] échec fatal :", err);
  process.exit(1);
});

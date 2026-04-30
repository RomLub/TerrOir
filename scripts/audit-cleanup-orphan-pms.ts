/**
 * T-441 audit/cleanup PMs Stripe orphelins.
 *
 * Contexte : la route app/api/stripe/ensure-default-payment-method/route.ts
 * (post-T-433 #70 Q7 fail-open extension) appelle stripe.paymentMethods.detach()
 * pour dédupliquer les PMs côté Stripe Customer. Si detach throw (race,
 * network blip, idempotency conflict), le code continue en soft (flag
 * dedupeFailed: true dans le payload) MAIS le PM duplicate reste attaché
 * au Customer Stripe → orphelin (cf reflag explicite ligne 135 de la route :
 * "T-441 reflag : cleanup PMs orphelins post-Live").
 *
 * Ce script identifie et delete ces PMs orphelins :
 *  1. Iterate users.stripe_customer_id NOT NULL via Supabase admin (DB-driven,
 *     cohérent pattern projet — pas via stripe.customers.list, jamais utilisé
 *     dans le repo).
 *  2. Pour chaque Customer, list PMs via stripe.paymentMethods.list(type=card).
 *  3. Group by card.fingerprint (skip null = cartes exotiques où Stripe ne
 *     fournit pas de fingerprint, cohérent paiements/actions.ts:108).
 *  4. Pour chaque groupe avec 2+ PMs (= dups) :
 *      - Si default_payment_method ∈ groupe → garder le default
 *      - Sinon → garder le plus récent (data[0] = DESC par created Stripe API)
 *      - Tous les autres = orphelins
 *  5. Mode dry-run par défaut : print rapport structuré.
 *  6. Mode --apply : detach orphelins via stripe.paymentMethods.detach().
 *
 * Garde-fous critiques :
 *  - Skip si fingerprint == null (cartes exotiques)
 *  - Jamais detach le default_payment_method (vérification stricte avant detach)
 *  - Si default null + dups → garder le plus récent (évite tout detach)
 *  - Sleep 100ms entre appels Stripe API (rate limit ~100 req/s, marge large)
 *  - Skip Customer Stripe.deleted (RGPD anonymisé / customer manuellement
 *    supprimé Dashboard)
 *  - Skip Customer Stripe resource_missing (id pointe sur compte inexistant
 *    Stripe-side, ex: anonymisé RGPD avec stripe_customer_id resté en DB)
 *
 * Note env Live vs Test :
 *  - Actuellement STRIPE_SECRET_KEY = sk_test_* (env Test, pré-T-002)
 *  - Post-T-002 (bascule Stripe Test → Live), ré-exécuter le script en
 *    env Live (.env.local switch sk_live_*) pour audit/cleanup prod.
 *  - Le script log son env (TEST/LIVE) au démarrage pour éviter toute
 *    confusion opérationnelle.
 *
 * Usage :
 *   npx tsx scripts/audit-cleanup-orphan-pms.ts                    # dry-run
 *   npx tsx scripts/audit-cleanup-orphan-pms.ts --apply            # commit detach
 *
 * Variables d'env requises (source .env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY
 *
 * Pattern aligné scripts/backfill-stripe-connect-flags.ts (T-419 historique).
 *
 * Couplage T-433 #70 (Q7 fail-open ensure-default-payment-method) +
 *           T-432 #69 (race anti-orphelin getOrCreateStripeCustomer) +
 *           T-419 (pattern backfill référence).
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

type UserRow = {
  id: string;
  email: string | null;
  stripe_customer_id: string;
};

type Counters = {
  customersScanned: number;
  customersDeleted: number;
  customersNoPms: number;
  customersWithOrphans: number;
  orphansDetected: number;
  orphansDetached: number;
  orphansDetachFailed: number;
  customerErrors: number;
};

async function main() {
  const env = STRIPE_SECRET_KEY?.startsWith("sk_test_") ? "TEST" : "LIVE";
  console.log(
    `[T-441] mode=${APPLY ? "APPLY" : "DRY-RUN"} stripe_env=${env} — ${
      APPLY ? "DETACH RÉEL" : "aucune écriture"
    }`,
  );
  console.log("");

  // Iterate Customers via DB. Pattern projet : DB-driven (jamais
  // stripe.customers.list, qui n'apparait nulle part dans le repo).
  const { data: users, error } = await admin
    .from("users")
    .select("id, email, stripe_customer_id")
    .not("stripe_customer_id", "is", null);

  if (error) {
    console.error("[T-441] erreur SELECT users :", error.message);
    process.exit(1);
  }

  const rows = (users ?? []) as UserRow[];
  console.log(`[T-441] ${rows.length} customer(s) à scanner`);
  console.log("");

  const counters: Counters = {
    customersScanned: 0,
    customersDeleted: 0,
    customersNoPms: 0,
    customersWithOrphans: 0,
    orphansDetected: 0,
    orphansDetached: 0,
    orphansDetachFailed: 0,
    customerErrors: 0,
  };

  for (const user of rows) {
    counters.customersScanned += 1;
    await processCustomer(user, counters);
    // Stripe rate limit standard = 100 req/s. 100ms entre chaque customer
    // garantit large marge même avec quelques retries internes du SDK.
    await sleep(100);
  }

  console.log("");
  console.log("=== RÉCAP ===");
  console.log(`mode                       : ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`stripe env                 : ${env}`);
  console.log(`customers scannés          : ${counters.customersScanned}`);
  console.log(`customers Stripe deleted   : ${counters.customersDeleted}`);
  console.log(`customers sans PM          : ${counters.customersNoPms}`);
  console.log(`customers avec orphelins   : ${counters.customersWithOrphans}`);
  console.log(`orphelins détectés         : ${counters.orphansDetected}`);
  if (APPLY) {
    console.log(`orphelins detach OK        : ${counters.orphansDetached}`);
    console.log(`orphelins detach FAIL      : ${counters.orphansDetachFailed}`);
  }
  console.log(`erreurs customer (skip)    : ${counters.customerErrors}`);

  if (!APPLY && counters.orphansDetected > 0) {
    console.log("");
    console.log(
      "Pour detach ces orphelins : npx tsx scripts/audit-cleanup-orphan-pms.ts --apply",
    );
  }
}

async function processCustomer(
  user: UserRow,
  counters: Counters,
): Promise<void> {
  const cid = user.stripe_customer_id;
  try {
    // Retrieve Customer pour récupérer default_payment_method.
    const customerResp = await stripe.customers.retrieve(cid);
    if ("deleted" in customerResp && customerResp.deleted) {
      counters.customersDeleted += 1;
      console.log(`[T-441] customer=${cid} email=${user.email ?? "?"} stripe_deleted skip`);
      return;
    }
    const customer = customerResp as Stripe.Customer;
    const defaultRaw = customer.invoice_settings?.default_payment_method;
    const defaultPmId =
      typeof defaultRaw === "string" ? defaultRaw : defaultRaw?.id ?? null;

    // List PMs (limit 100 pour couvrir le cas extrême ; user particulier
    // typiquement < 5 cartes).
    const pms = await stripe.paymentMethods.list({
      customer: cid,
      type: "card",
      limit: 100,
    });

    if (pms.data.length === 0) {
      counters.customersNoPms += 1;
      return;
    }

    // Group by fingerprint (skip null = cartes exotiques sans fingerprint,
    // cohérent app/(consumer)/compte/paiements/actions.ts:108).
    const byFingerprint = new Map<string, Stripe.PaymentMethod[]>();
    for (const pm of pms.data) {
      const fp = pm.card?.fingerprint;
      if (!fp) continue;
      const list = byFingerprint.get(fp);
      if (list) {
        list.push(pm);
      } else {
        byFingerprint.set(fp, [pm]);
      }
    }

    // Identifier orphelins.
    const orphans: Stripe.PaymentMethod[] = [];
    for (const [, group] of byFingerprint) {
      if (group.length < 2) continue;

      // Choix du keeper :
      //  - Si default ∈ groupe → keeper = default (jamais detach le default,
      //    garde-fou critique).
      //  - Sinon → keeper = plus récent (data[0], Stripe API list est DESC
      //    par created par défaut).
      let keeper: Stripe.PaymentMethod;
      const defaultInGroup = defaultPmId
        ? group.find((pm) => pm.id === defaultPmId)
        : undefined;
      if (defaultInGroup) {
        keeper = defaultInGroup;
      } else {
        keeper = group[0];
      }

      for (const pm of group) {
        if (pm.id !== keeper.id) orphans.push(pm);
      }
    }

    if (orphans.length === 0) return;

    counters.customersWithOrphans += 1;
    counters.orphansDetected += orphans.length;

    console.log(
      `[T-441] customer=${cid} email=${user.email ?? "?"} default=${
        defaultPmId ?? "null"
      } orphans=${orphans.length}`,
    );
    for (const orphan of orphans) {
      console.log(
        `  - pm=${orphan.id} fp=${orphan.card?.fingerprint ?? "?"} ${
          orphan.card?.brand ?? "?"
        } ****${orphan.card?.last4 ?? "????"} created=${new Date(
          orphan.created * 1000,
        ).toISOString()}`,
      );
    }

    if (!APPLY) return;

    for (const orphan of orphans) {
      try {
        await stripe.paymentMethods.detach(orphan.id);
        counters.orphansDetached += 1;
        console.log(`  detach OK ${orphan.id}`);
      } catch (e) {
        counters.orphansDetachFailed += 1;
        const err = e as { code?: string; message?: string };
        console.warn(
          `  detach FAIL ${orphan.id} (${err.code ?? "unknown"}): ${
            err.message ?? "no message"
          }`,
        );
      }
      await sleep(100);
    }
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // resource_missing : stripe_customer_id en DB mais Customer supprimé
    // côté Stripe (cas RGPD anonymisé partiellement, ou cleanup manuel
    // Dashboard). Skip silencieux côté counter dédié.
    if (err.code === "resource_missing") {
      counters.customersDeleted += 1;
      console.warn(
        `[T-441] customer=${cid} email=${user.email ?? "?"} stripe resource_missing skip`,
      );
      return;
    }
    counters.customerErrors += 1;
    console.error(
      `[T-441] customer=${cid} email=${user.email ?? "?"} erreur ${
        err.code ?? "unknown"
      }: ${err.message ?? "no message"}`,
    );
  }
}

main().catch((err) => {
  console.error("[T-441] échec fatal :", err);
  process.exit(1);
});

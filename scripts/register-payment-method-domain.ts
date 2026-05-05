/**
 * Registration idempotente du domaine `www.terroir-local.fr` auprès de
 * Stripe pour activer Apple Pay + Google Pay (+ Link) sur le checkout
 * consumer.
 *
 * Contexte : audit Stripe phase 2 M-1 + L-3 (cf docs/audits/audit-stripe-
 * 2026-05-05.md et docs/audits/audit-stripe-m1-l3-investigation-2026-05-05.md).
 * Depuis avril 2025, Stripe gère la vérification Apple sans fichier
 * `.well-known/apple-developer-merchantid-domain-association` — il suffit
 * d'enregistrer le domaine via `payment_method_domains`. Stripe joue le
 * rôle d'Apple Merchant et signe la verification en interne.
 *
 * Idempotence : list les domaines existants, skip si `www.terroir-local.fr`
 * déjà enregistré (et log les statuses Apple/Google), sinon create.
 *
 * Usage :
 *   npx tsx scripts/register-payment-method-domain.ts             # dry-run
 *   npx tsx scripts/register-payment-method-domain.ts --apply     # create si absent
 *   npx tsx scripts/register-payment-method-domain.ts --apply --domain shop.terroir-local.fr
 *
 * Variables d'env requises (source .env.local) :
 *   STRIPE_SECRET_KEY  (test ou live selon contexte)
 *
 * Sortie attendue après --apply :
 *   - domain ID (`pmd_...`)
 *   - statuses Apple Pay / Google Pay / Link / Amazon Pay / Paypal / Klarna
 *   - status global `enabled: true`
 *
 * Le script ne touche PAS la DB TerrOir (pas d'effet de bord local).
 *
 * Cohérence multi-domaines : les sous-domaines `pro.terroir-local.fr` et
 * `admin.terroir-local.fr` ne servent pas de checkout consumer → pas
 * besoin de les enregistrer. Seul `www.terroir-local.fr` est concerné par
 * M-1 + L-3.
 */

import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");
const DOMAIN_ARG_INDEX = process.argv.indexOf("--domain");
const DOMAIN =
  DOMAIN_ARG_INDEX >= 0 && process.argv[DOMAIN_ARG_INDEX + 1]
    ? process.argv[DOMAIN_ARG_INDEX + 1]!
    : "www.terroir-local.fr";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error(
    "Manque STRIPE_SECRET_KEY. Source .env.local avant de lancer le script.",
  );
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2026-04-22.dahlia",
  typescript: true,
});

function formatStatuses(domain: Stripe.PaymentMethodDomain): string {
  const blocks: string[] = [];
  const wallets: Array<keyof Stripe.PaymentMethodDomain> = [
    "apple_pay",
    "google_pay",
    "link",
    "paypal",
  ];
  for (const wallet of wallets) {
    const w = domain[wallet] as
      | { status: string; status_details?: { error_message?: string } }
      | undefined;
    if (!w) continue;
    blocks.push(
      `${String(wallet)}=${w.status}${w.status_details?.error_message ? ` (${w.status_details.error_message})` : ""}`,
    );
  }
  return blocks.join(" | ");
}

async function findExistingDomain(
  domainName: string,
): Promise<Stripe.PaymentMethodDomain | null> {
  // List + filter by domain_name. Stripe expose `domain_name` en filtre.
  const list = await stripe.paymentMethodDomains.list({
    domain_name: domainName,
    limit: 10,
  });
  return list.data.find((d) => d.domain_name === domainName) ?? null;
}

async function main() {
  console.log(
    `[REGISTER_PMD] mode=${APPLY ? "APPLY" : "DRY-RUN"} domain=${DOMAIN} secret=${STRIPE_SECRET_KEY!.startsWith("sk_test_") ? "test" : STRIPE_SECRET_KEY!.startsWith("sk_live_") ? "LIVE" : "unknown"}`,
  );

  const account = await stripe.accounts.retrieve(null);
  console.log(
    `[REGISTER_PMD] account=${account.id} (${account.business_profile?.name ?? "unnamed"})`,
  );

  const existing = await findExistingDomain(DOMAIN);

  if (existing) {
    console.log(
      `[REGISTER_PMD] EXISTS id=${existing.id} enabled=${existing.enabled} created=${new Date(existing.created * 1000).toISOString()}`,
    );
    console.log(`[REGISTER_PMD] STATUSES ${formatStatuses(existing)}`);
    if (!APPLY) {
      console.log("[REGISTER_PMD] dry-run → no action.");
    }
    // Validation : si Apple/Google sont en `inactive` avec un error_message,
    // signaler explicitement (Stripe peut le rendre `inactive` si la registration
    // a échoué côté Apple — cas rare mais à investiguer manuellement).
    const blocking: string[] = [];
    if (existing.apple_pay?.status === "inactive") blocking.push("apple_pay");
    if (existing.google_pay?.status === "inactive") blocking.push("google_pay");
    if (blocking.length > 0) {
      console.warn(
        `[REGISTER_PMD] WARNING : statuses inactive=${blocking.join(",")} — vérifier Dashboard https://dashboard.stripe.com/settings/payment_method_domains`,
      );
    }
    return;
  }

  console.log(`[REGISTER_PMD] NOT FOUND — domain à enregistrer.`);

  if (!APPLY) {
    console.log("[REGISTER_PMD] dry-run → re-run avec --apply pour créer.");
    return;
  }

  // Create idempotent : Stripe rejette de toute façon un duplicate domain_name
  // sur le même compte (HTTP 400 `domain_name_already_registered`). Le check
  // findExistingDomain ci-dessus est notre garde primaire ; si une race
  // s'intercalait, on tomberait dans ce catch.
  let created: Stripe.PaymentMethodDomain;
  try {
    created = await stripe.paymentMethodDomains.create({
      domain_name: DOMAIN,
    });
  } catch (err) {
    if (
      err instanceof Stripe.errors.StripeError &&
      err.message.includes("already")
    ) {
      console.warn(
        `[REGISTER_PMD] race detected — re-fetch existing domain.`,
      );
      const refetch = await findExistingDomain(DOMAIN);
      if (!refetch) throw err;
      created = refetch;
    } else {
      throw err;
    }
  }

  console.log(
    `[REGISTER_PMD] CREATED id=${created.id} enabled=${created.enabled}`,
  );
  console.log(`[REGISTER_PMD] STATUSES ${formatStatuses(created)}`);

  // Validation finale : Apple Pay et Google Pay devraient être en `active` ou
  // `pending` (verification Stripe en cours). `inactive` = erreur côté
  // registration → STOP et signaler.
  const blocking: string[] = [];
  if (created.apple_pay?.status === "inactive") blocking.push("apple_pay");
  if (created.google_pay?.status === "inactive") blocking.push("google_pay");
  if (blocking.length > 0) {
    console.error(
      `[REGISTER_PMD] ERROR : statuses inactive=${blocking.join(",")}. ` +
        `Vérifier Dashboard https://dashboard.stripe.com/settings/payment_method_domains.`,
    );
    process.exit(2);
  }

  console.log("[REGISTER_PMD] OK ✓");
}

main().catch((err) => {
  console.error(`[REGISTER_PMD] FATAL ${(err as Error).message}`);
  process.exit(1);
});

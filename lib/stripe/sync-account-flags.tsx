import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { waitUntil } from "@vercel/functions";
import { sendOpsAlert } from "@/lib/ops/alert";
import { sendTemplate } from "@/lib/resend/send";
import ProducerKycBlocked, {
  subject as producerKycBlockedSubject,
} from "@/lib/resend/templates/producer-kyc-blocked";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Extrait du handler webhook `account.updated` (cf app/api/stripe/webhook/route.tsx).
// Sortie en module séparé pour pouvoir tester en isolation : le handler
// route.tsx reste un thin wrapper qui appelle cette fonction puis ack 200.
//
// Sémantique reproduite à l'identique du handler historique (commit `de4a2cd`) :
//   - Lit charges_enabled / payouts_enabled / details_submitted de l'objet
//     Stripe.Account (cast booléen défensif).
//   - UPDATE producers SET les 3 flags WHERE stripe_account_id = account.id.
//   - Producer orphelin (aucune row matchée) = cas normal côté Stripe (compte
//     Connect créé sans persistance DB, ou producer déjà RGPD-anonymisé) →
//     return { updated: false } sans throw, le caller ack 200 quand même.
//   - Erreur PostgREST = log warn préfixé grep-able sans throw (cohérent
//     avec le pattern fail-open du handler historique : Stripe ne retry pas
//     un 200 même si on a raté l'UPDATE — ce qui évite des storms à chaque
//     race condition transitoire et garde la signature reset par account.id
//     quand Stripe re-émet l'event).
//
// Différence subtile avec le handler historique : ajout de `.select('id')`
// pour matérialiser la liste des rows touchées (Prefer: return=representation
// côté PostgREST). Invisible côté Stripe, nécessaire pour distinguer
// updated=true vs updated=false (producer orphelin) côté tests + telemetry.
//
// F-042 (audit pré-launch 2026-05-11) — détection transition charges_enabled
// `true → false` : lit l'état précédent côté DB avant l'UPDATE pour
// identifier qu'un compte précédemment OK vient d'être bloqué. Si transition
// détectée :
//   - sendOpsAlert("[STRIPE_CHARGES_DISABLED]", ...) avec disabled_reason +
//     currently_due exposés depuis account.requirements.
//   - Email producer ("producer_kyc_blocked") via Resend avec la même info,
//     pour qu'il puisse régulariser depuis Dashboard Stripe Express.
// Les deux side-effects passent par waitUntil() : on ne bloque pas la
// réponse 200 webhook, et un échec Resend/Sentry est swallow (fail-safe,
// cohérent avec le pattern handler historique).
//
// Pas de notification équivalente sur transition `false → true` (compte
// débloqué) : intentionnel — le producer le voit naturellement via le
// dashboard TerrOir et reçoit une nouvelle commande dès qu'un consumer
// passe. Ajout possible plus tard si on veut être sympa, hors scope F-042.

type ProducerRow = {
  id: string;
  user_id: string | null;
  nom_exploitation: string | null;
  stripe_charges_enabled: boolean | null;
};

export async function syncStripeAccountFlags(
  account: Stripe.Account,
  admin: SupabaseClient,
): Promise<{ updated: boolean; producerId: string | null }> {
  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  const detailsSubmitted = !!account.details_submitted;

  console.log(
    `[STRIPE_ACCOUNT_UPDATED] account=${account.id} charges=${chargesEnabled} payouts=${payoutsEnabled} details=${detailsSubmitted}`,
  );

  // F-042 — lecture de l'état précédent côté DB AVANT l'UPDATE pour
  // détecter la transition `true → false` sur charges_enabled. Si la row
  // n'existe pas (orphelin), previousChargesEnabled reste null et la
  // détection ne se déclenche pas.
  const { data: previousRow } = await admin
    .from("producers")
    .select("id, user_id, nom_exploitation, stripe_charges_enabled")
    .eq("stripe_account_id", account.id)
    .maybeSingle();
  const previous = previousRow as ProducerRow | null;
  const previousChargesEnabled = previous?.stripe_charges_enabled ?? null;

  const { data, error } = await admin
    .from("producers")
    .update({
      stripe_charges_enabled: chargesEnabled,
      stripe_payouts_enabled: payoutsEnabled,
      stripe_details_submitted: detailsSubmitted,
    })
    .eq("stripe_account_id", account.id)
    .select("id");

  if (error) {
    console.warn(
      `[STRIPE_ACCOUNT_UPDATED_ERR] account=${account.id} error=${(error as { message?: string }).message ?? "unknown"}`,
    );
    return { updated: false, producerId: null };
  }

  if (!Array.isArray(data) || data.length === 0) {
    // T-419 — log greppable pour identifier les orphelins (account.id Stripe
    // sans row producer en DB). Permet l'intervention manuelle admin (cas
    // T-418 orphelin pré-fix, ou producer RGPD-anonymisé après webhook).
    console.warn(`[STRIPE_ACCOUNT_NOT_FOUND] account=${account.id}`);
    return { updated: false, producerId: null };
  }

  const producerId = String((data[0] as { id: unknown }).id);

  // F-042 — détection transition `true → false` sur charges_enabled.
  // Strict equality booléen : null (orphan/legacy column) → pas de transition,
  // false → false (déjà bloqué, on ne re-spam pas), true → true (no-op).
  if (previousChargesEnabled === true && chargesEnabled === false) {
    const requirements = account.requirements ?? null;
    const disabledReason = requirements?.disabled_reason ?? null;
    const currentlyDue = Array.isArray(requirements?.currently_due)
      ? requirements.currently_due
      : [];

    console.error(
      `[STRIPE_CHARGES_DISABLED] producer=${producerId} account=${account.id} disabled_reason=${disabledReason ?? "null"} currently_due_count=${currentlyDue.length}`,
    );

    // 1. Ops alert (Sentry + email admin).
    waitUntil(
      sendOpsAlert(
        "[STRIPE_CHARGES_DISABLED]",
        new Error(
          `Stripe a désactivé charges_enabled sur le Connect account ${account.id} (producer=${producerId}, reason=${disabledReason ?? "unknown"}).`,
        ),
        {
          producer_id: producerId,
          stripe_account_id: account.id,
          disabled_reason: disabledReason,
          currently_due: currentlyDue,
          payouts_enabled: payoutsEnabled,
          details_submitted: detailsSubmitted,
        },
      ),
    );

    // 2. Email producer. Lookup email via users (producer.user_id → users.email).
    // Best-effort : si producer.user_id null (legacy) ou users introuvable,
    // on log + skip — l'ops alert ci-dessus reste, l'admin contactera
    // manuellement le producer.
    waitUntil(
      sendProducerKycBlockedEmail(
        admin,
        previous,
        account.id,
        disabledReason,
        currentlyDue,
      ).catch((err) => {
        console.warn(
          `[STRIPE_CHARGES_DISABLED_EMAIL_ERR] producer=${producerId} account=${account.id} error=${(err as Error).message}`,
        );
      }),
    );
  }

  return { updated: true, producerId };
}

async function sendProducerKycBlockedEmail(
  admin: SupabaseClient,
  producer: ProducerRow | null,
  stripeAccountId: string,
  disabledReason: string | null,
  currentlyDue: string[],
): Promise<void> {
  if (!producer) return;
  if (!producer.user_id) {
    console.warn(
      `[STRIPE_CHARGES_DISABLED_NO_USER] producer=${producer.id} — user_id null, email producer non envoyé`,
    );
    return;
  }

  const { data: userRow } = await admin
    .from("users")
    .select("email")
    .eq("id", producer.user_id)
    .maybeSingle();
  const email = (userRow as { email: string | null } | null)?.email ?? null;
  if (!email) {
    console.warn(
      `[STRIPE_CHARGES_DISABLED_NO_EMAIL] producer=${producer.id} user=${producer.user_id} — email introuvable, skip`,
    );
    return;
  }

  // Dashboard Connect Express : pas d'URL stable côté plateforme (Stripe
  // génère un lien temporaire via /api/stripe/connect/onboard côté front
  // producer). On envoie le producer sur le tableau de bord TerrOir, qui
  // pointe vers le bon endpoint au sein du flow connecté.
  const dashboardUrl = `${NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/dashboard`;
  const props = {
    exploitation: producer.nom_exploitation,
    producerId: producer.id,
    stripeAccountId,
    disabledReason,
    currentlyDue,
    dashboardUrl,
  };

  await sendTemplate({
    to: email,
    userId: producer.user_id,
    template: "producer_kyc_blocked",
    subject: producerKycBlockedSubject(props),
    element: <ProducerKycBlocked {...props} />,
    metadata: {
      producer_id: producer.id,
      stripe_account_id: stripeAccountId,
      disabled_reason: disabledReason,
    },
  });
}

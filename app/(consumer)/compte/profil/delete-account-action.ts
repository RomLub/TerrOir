"use server";

// =============================================================================
// Server action : suppression de compte RGPD (self-service)
// =============================================================================
// Orchestre la séquence complète côté serveur :
//   1. Re-auth password via client Supabase temporaire (anon key,
//      persistSession=false) → verify sans toucher aux cookies de session.
//   2. Capture de l'état producer (id + stripe_account_id) avant RPC.
//   2bis. Capture users.stripe_customer_id avant RPC (disparaît par CASCADE
//      en étape 7 sinon — besoin pour appeler stripe.customers.del).
//   3. Appel RPC public.delete_user_account(p_user_id) → anonymise orders,
//      hard-delete reviews/products/slots, anonymise producer en statut
//      'deleted' (cf migration 20260422200000).
//   4. Cleanup Stripe Connect fail-open. Si échec → flag
//      producers.stripe_cleanup_pending=true via service_role (le producer
//      est anonymisé user_id=NULL, donc la policy owner_update ne matche
//      plus). Log explicite pour alertes Vercel.
//   4bis. Cleanup Stripe Customer fail-open (détache PaymentMethods côté
//      Stripe). Pas de flag DB persistant car users.stripe_customer_id
//      disparaît par CASCADE en étape 7. Log explicite si échec.
//   5. Email de confirmation via Resend. Le log notifications écrit par
//      sendTemplate sera wipé par le CASCADE en étape 7 (propre RGPD).
//   6. Server signOut → clear cookies sb-* pendant que auth.users existe
//      encore (évite l'edge case signOut sur user supprimé).
//   7. admin.deleteUser(id) via service_role → CASCADE public.users +
//      public.notifications + public.admin_users (ce dernier vide en
//      pratique car on refuse la self-deletion admin hors scope).
//   8. Return { success: true } → le client déclenche browser signOut +
//      redirect vers '/' (rafraîchit UserProvider via onAuthStateChange).
//
// Guards appliqués par la RPC (Phase 1) :
//   - auth.uid() doit correspondre à p_user_id (via JWT du server client)
//   - Aucune commande en statut pending/confirmed côté consumer
//   - Aucune commande en statut pending/confirmed côté producer
//
// Cas de test à valider en prod (Phase 4) :
//   A. Consumer pur, 0 commande                 → suppression instantanée
//   B. Consumer avec commandes completed        → orders anonymisées
//                                                  (consumer_id=NULL), reviews
//                                                  écrites hard-deleted
//   C. Consumer+producer avec produits+commandes reçues completed
//                                               → products/slots hard-deleted,
//                                                  reviews reçues wipées,
//                                                  producer anonymisé
//                                                  (statut='deleted'), orders
//                                                  reçues conservées pour
//                                                  comptabilité, Stripe
//                                                  Connect deletion tentée
//   D. Consumer avec commande statut='confirmed' en attente
//                                               → RPC lève P0001 → message
//                                                  user-friendly, suppression
//                                                  bloquée
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeIlikeEmail } from "@/lib/supabase/escape-ilike";
import { getSessionUser } from "@/lib/auth/session";
import {
  deleteStripeConnectAccount,
  deleteStripeCustomer,
} from "@/lib/stripe/cleanup";
import { sendTemplate } from "@/lib/resend/send";
import AccountDeleted, {
  subject as accountDeletedSubject,
} from "@/lib/resend/templates/account-deleted";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { maskEmail } from "@/lib/rgpd/mask-email";

export type DeleteAccountState = {
  error?: string;
  success?: boolean;
};

const deleteAccountSchema = z.object({
  password: z.string().min(1, "Mot de passe requis"),
});

export async function deleteAccountAction(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  // 1. Session courante
  const session = await getSessionUser();
  if (!session || !session.email) {
    return { error: "Session introuvable. Reconnectez-vous." };
  }

  // 2. Parse password + re-auth via client temporaire (anon + persistSession=false)
  //    → pas de singleton, pas de cookie, pas d'effet de bord sur la session.
  const parsed = deleteAccountSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Saisie invalide",
    };
  }

  const tempClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { error: signInError } = await tempClient.auth.signInWithPassword({
    email: session.email,
    password: parsed.data.password,
  });

  if (signInError) {
    return { error: "Mot de passe incorrect." };
  }

  // Audit forensique RGPD : log AVANT le RPC delete (sinon user_id perdu
  // par CASCADE auth.users → public.users à l'étape 8). metadata.email_masked
  // via maskEmail (rappel : metadata.email en clair est OK côté audit_logs DB
  // — cf. magic_link conv. — mais ici on suit le pattern PII minimal du
  // brief T-081).
  await logAuthEvent({
    eventType: "account_deleted",
    userId: session.id,
    metadata: { email_masked: maskEmail(session.email) },
  });

  // 3. Capture producer state AVANT RPC (l'anonymisation va NULL le stripe_account_id)
  const admin = createSupabaseAdminClient();
  const { data: producer } = await admin
    .from("producers")
    .select("id, stripe_account_id")
    .eq("user_id", session.id)
    .maybeSingle();

  const producerId = (producer?.id as string | undefined) ?? null;
  const stripeAccountId =
    (producer?.stripe_account_id as string | null | undefined) ?? null;

  // 3bis. Capture users.stripe_customer_id AVANT la suppression
  //       (CASCADE via auth.users le fera disparaître en étape 8).
  const { data: user } = await admin
    .from("users")
    .select("stripe_customer_id")
    .eq("id", session.id)
    .maybeSingle();

  const stripeCustomerId =
    (user?.stripe_customer_id as string | null | undefined) ?? null;

  // 4. RPC delete_user_account via client authentifié (auth.uid() = session.id)
  const supabase = await createSupabaseServerClient();
  const { error: rpcError } = await supabase.rpc("delete_user_account", {
    p_user_id: session.id,
  });

  if (rpcError) {
    // P0001 = guard commandes actives (cf RPC Phase 1)
    if (rpcError.code === "P0001") {
      return {
        error:
          "Finalisez ou annulez vos commandes en cours avant de supprimer votre compte.",
      };
    }
    console.error(
      `ACCOUNT_DELETE_RPC_ERROR user_id=${session.id} code=${rpcError.code} message=${rpcError.message}`,
    );
    return {
      error: "Une erreur est survenue. Contactez le support.",
    };
  }

  // Si le user était producer, la RPC a anonymisé producers (statut='deleted')
  // et hard-deleté ses products. Le cache public-stats (filtre statut='public')
  // doit être invalidé. Inconditionnel : un consumer pur génère une invalidation
  // no-op côté cache, coût négligeable.
  try {
    revalidateTag("public-stats", "max");
  } catch (e) {
    console.warn(`[STATS_REVAL_WARN] user=${session.id} ${(e as Error).message}`);
  }

  // 5. Stripe Connect cleanup (fail-open + flag si échec)
  if (stripeAccountId && producerId) {
    const stripeResult = await deleteStripeConnectAccount(stripeAccountId);
    if (!stripeResult.success) {
      console.error(
        `STRIPE_CLEANUP_PENDING producer_id=${producerId} stripe_account_id=${stripeAccountId} error=${stripeResult.error}`,
      );
      await admin
        .from("producers")
        .update({ stripe_cleanup_pending: true })
        .eq("id", producerId);
    }
  }

  // 5bis. Stripe Customer cleanup (fail-open, log seul si échec).
  //       Pas de flag DB persistant : users.stripe_customer_id disparaît
  //       par CASCADE à l'étape 8. Log explicite pour grep alertes Vercel.
  if (stripeCustomerId) {
    const customerResult = await deleteStripeCustomer(stripeCustomerId);
    if (!customerResult.success) {
      console.error(
        `STRIPE_CUSTOMER_CLEANUP_PENDING user_id=${session.id} stripe_customer_id=${stripeCustomerId} error=${customerResult.error}`,
      );
    }
  }

  // 6. Email de confirmation (log wipé par le CASCADE en étape 7)
  const deletedAt = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const emailProps = { deletedAt };
  await sendTemplate({
    to: session.email,
    userId: session.id,
    template: "account_deleted",
    subject: accountDeletedSubject(emailProps),
    element: createElement(AccountDeleted, emailProps),
  });

  // 7. Server signOut AVANT admin.deleteUser (clear cookies pendant que
  //    l'user existe encore côté auth.users — évite l'edge case signOut
  //    sur user déjà supprimé).
  await supabase.auth.signOut();

  // 7bis. Cleanup producer_interests (audit Auth H-2, RGPD article 17).
  //       Si l'user avait déposé un intérêt waitlist avec le même email
  //       avant de créer son compte, ces données survivraient sinon
  //       (pas de FK vers auth.users). Fail-open : un échec ici ne doit
  //       pas bloquer la suppression du compte.
  try {
    const { count } = await admin
      .from("producer_interests")
      .delete({ count: "exact" })
      .ilike("email", escapeIlikeEmail(session.email));
    if (count && count > 0) {
      console.warn("[delete-account] producer_interests cleanup", {
        user_id_masked: session.id.slice(0, 8) + "...",
        rows: count,
      });
    }
  } catch (err) {
    console.error("[delete-account] producer_interests cleanup failed", {
      user_id_masked: session.id.slice(0, 8) + "...",
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // 8. Suppression effective via Admin API (CASCADE public.users + notifications)
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(
    session.id,
  );
  if (deleteUserError) {
    // État dégradé : cookies clean, RPC exécutée, mais auth.users persiste.
    // À la reconnexion, le middleware verra un user sans profil (public.users
    // intact via CASCADE qui a partiellement tourné — en pratique rare).
    // Log explicite pour alertes.
    console.error(
      `ACCOUNT_DELETE_AUTH_ORPHAN user_id=${session.id} error=${deleteUserError.message}`,
    );
  }

  // 9. Redirect serveur vers /?compte-supprime=1.
  //    Pourquoi pas un return { success: true } : Next 16 auto-revalide la
  //    route courante après chaque server action. Or /compte/profil est
  //    protégée par middleware → l'auth.getUser() post-deleteUser renvoie
  //    null → redirect vers /connexion. Conséquence : la modale "Compte
  //    supprimé" est unmount avant rendu côté client (race confirmée par
  //    test E2E delete-account.spec.ts:82 timeout sur heading).
  //
  //    Solution : `redirect()` côté serveur. Next renvoie une 303 directement
  //    vers / (route publique) — pas de revalidation /compte/profil → pas de
  //    redirect parasite vers /connexion. La home page lit le query param et
  //    affiche le confirmation-banner "Compte supprimé".
  redirect("/?compte-supprime=1");
}

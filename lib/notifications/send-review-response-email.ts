import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import { shouldSendEmail } from "@/lib/notifications/preferences";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";
import ReviewResponseNotification, {
  subject as reviewResponseSubject,
} from "@/lib/resend/templates/review-response-notification";

interface SendReviewResponseEmailArgs {
  reviewId: string;
  consumerId: string;
  producerId: string;
  responseText: string;
}

// Envoi email consumer notifiant la réponse producer à son avis. Respecte
// la pref user_notification_preferences.email_review_response (default=true).
//
// Path skipped : si la pref est désactivée, on log au format
// notifications statut='skipped' (cohérent avec sendTemplate skipped via
// suppressions) et on retourne ok=false skipped=true.
//
// Path failed : render fail / Resend 5xx → log notifications statut='failed'
// + retour ok=false. Ne re-throw pas (caller décide quoi en faire).
//
// Best-effort : un échec email NE doit PAS rollback la publication de la
// réponse producer (engagement contractuel CGU 6.4 prime sur la
// notification consumer). Caller wrap dans try/catch + console.warn.

export async function sendReviewResponseEmail(
  args: SendReviewResponseEmailArgs,
): Promise<{ ok: true; id?: string } | { ok: false; skipped?: true; error: string }> {
  const allowed = await shouldSendEmail(args.consumerId, "email_review_response");
  if (!allowed) {
    const admin = createSupabaseAdminClient();
    await admin.from("notifications").insert({
      user_id: args.consumerId,
      type: "email",
      template: "review_response_notification",
      statut: "skipped",
      metadata: {
        review_id: args.reviewId,
        producer_id: args.producerId,
        skip_reason: "user_pref_disabled",
      },
    });
    return { ok: false, skipped: true, error: "user_pref_disabled" };
  }

  // Lookup consumer email + producer name. Admin client (lib backend).
  const admin = createSupabaseAdminClient();
  const [{ data: consumer }, { data: producer }, { data: review }] =
    await Promise.all([
      admin
        .from("users")
        .select("email, prenom")
        .eq("id", args.consumerId)
        .maybeSingle(),
      admin
        .from("producers")
        .select("nom_exploitation, slug")
        .eq("id", args.producerId)
        .maybeSingle(),
      admin
        .from("reviews")
        .select("commentaire")
        .eq("id", args.reviewId)
        .maybeSingle(),
    ]);

  if (!consumer?.email || !producer?.nom_exploitation || !producer?.slug) {
    return { ok: false, error: "Données destinataire/producer indisponibles" };
  }

  const props = {
    consumerFirstName: consumer.prenom ?? "",
    producerName: producer.nom_exploitation,
    originalReview: review?.commentaire ?? "",
    responseText: args.responseText,
    producerUrl: `${NEXT_PUBLIC_APP_URL}/producteurs/${producer.slug}`,
    preferencesUrl: `${NEXT_PUBLIC_APP_URL}/compte/notifications`,
  };

  const result = await sendTemplate({
    to: consumer.email,
    userId: args.consumerId,
    template: "review_response_notification",
    subject: reviewResponseSubject(props),
    element: ReviewResponseNotification(props),
    metadata: {
      review_id: args.reviewId,
      producer_id: args.producerId,
    },
  });

  return result;
}

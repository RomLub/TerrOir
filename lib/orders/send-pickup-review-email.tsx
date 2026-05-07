import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplate } from "@/lib/resend/send";
import ReviewRequest, {
  subject as reviewSubject,
} from "@/lib/resend/templates/review-request";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Helper d'envoi de l'email "review-request J0" déclenché juste après une
// transition confirmed → completed (validation pickup côté producer).
//
// Extrait du bloc historiquement inline dans
// app/api/orders/[id]/complete/route.tsx pour permettre la réutilisation
// par la nouvelle route code-based /api/producer/orders/validate-pickup
// (LOT 3 chantier pickup-validation 2026-05-06).
//
// Comportement préservé strictement :
//   - Lookup users.email + producers.nom_exploitation côté admin
//   - Si l'un des deux manque → skip propre (pas d'erreur, pas d'email)
//   - sendTemplate avec template='review_request_j0' + dayOffset=0
//   - reviewUrl pointe sur /compte/mes-avis/{id}/nouveau (consumer side)
//   - metadata.order_id + metadata.code_commande pour traçabilité
//
// Fail-open implicite via sendTemplate (qui swallow les erreurs Resend en
// interne et retourne {ok: false, ...}). Le caller peut ignorer le retour
// — un échec d'envoi email ne doit jamais empêcher la transition de
// commande en DB d'être marquée 200 côté API (le pickup s'est produit
// physiquement, l'email est best-effort).

type SendPickupReviewEmailParams = {
  orderId: string;
  consumerId: string;
  producerId: string;
  codeCommande: string;
};

type SendPickupReviewEmailResult =
  | { ok: true; sent: true }
  | { ok: false; skipped: true; reason: "consumer_email_missing" | "producer_missing" }
  | { ok: false; failed: true };

export async function sendPickupReviewEmail(
  admin: SupabaseClient,
  params: SendPickupReviewEmailParams,
): Promise<SendPickupReviewEmailResult> {
  const { data: consumerData } = await admin
    .from("users")
    .select("email")
    .eq("id", params.consumerId)
    .maybeSingle();
  const consumer = consumerData as { email: string | null } | null;

  if (!consumer?.email) {
    return { ok: false, skipped: true, reason: "consumer_email_missing" };
  }

  const { data: producerData } = await admin
    .from("producers")
    .select("nom_exploitation")
    .eq("id", params.producerId)
    .maybeSingle();
  const producer = producerData as { nom_exploitation: string } | null;

  if (!producer) {
    return { ok: false, skipped: true, reason: "producer_missing" };
  }

  const props = {
    codeCommande: params.codeCommande,
    exploitation: producer.nom_exploitation,
    reviewUrl: `${NEXT_PUBLIC_APP_URL}/compte/mes-avis/${params.orderId}/nouveau`,
    dayOffset: 0 as const,
  };

  const result = await sendTemplate({
    to: consumer.email,
    userId: params.consumerId,
    template: "review_request_j0",
    subject: reviewSubject(props),
    element: <ReviewRequest {...props} />,
    metadata: { order_id: params.orderId, code_commande: params.codeCommande },
  });

  return result.ok ? { ok: true, sent: true } : { ok: false, failed: true };
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplate } from "@/lib/resend/send";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";
import StockAlertBackInStock, {
  subject as backInStockSubject,
} from "@/lib/resend/templates/stock-alert-back-in-stock";

// Helper de notification "retour en stock". Appelé en hook synchrone par
// la route PATCH producer post-UPDATE stock_disponible (PUSH 5a).
//
// Sémantique :
//   1. Fetch product (nom + producer_id) via service-role.
//   2. Fetch producer (slug + nom_exploitation) pour construire URL +
//      personnaliser email. Si producer fetch échoue mais product OK,
//      on continue sans producerName (lien fallback) — pas de blocage.
//   3. Fetch alertes éligibles (confirmed_at NOT NULL, notified_at IS
//      NULL, unsubscribed_at IS NULL) pour ce produit.
//   4. Pour chaque alerte : sendTemplate(stock-alert-back-in-stock).
//      Si send OK → UPDATE notified_at = now(). Si send fail OU UPDATE
//      fail → log + skip cette alerte, continue les autres (pas de
//      fail global).
//
// Choix d'ordre send-puis-update :
//   - send OK + update fail : email parti, notified_at non setté → si
//     producer re-update stock plus tard, l'alerte sera re-trouvée et
//     un 2e email partira (double-email rare mais possible). Acceptable.
//   - update OK + send fail : email pas parti, notified_at setté → user
//     ne recevra jamais l'email même si on retry (perte définitive).
//     Pire scénario, donc on choisit l'inverse.
//
// Pas de throw : log+return aligne convention codebase. Le caller (route
// PATCH PUSH 5a) ignore le résultat ou le remonte en metadata côté UI.

export interface NotifyBackInStockResult {
  // Nb d'emails envoyés ET notified_at UPDATE OK.
  sent: number;
  // Nb d'emails échoués OU notified_at UPDATE échoué (l'alerte n'a pas
  // été marquée notifiée — sera re-tentée au prochain hook).
  failed: number;
  // Nb d'alertes non tentées car prérequis manquants (product fetch
  // failed, alerts fetch failed). Toujours 0 si tout va bien.
  skipped: number;
}

export async function notifyBackInStock(
  admin: SupabaseClient,
  productId: string,
): Promise<NotifyBackInStockResult> {
  // 1. Fetch product
  const { data: productData, error: productError } = await admin
    .from("products")
    .select("id, nom, producer_id")
    .eq("id", productId)
    .maybeSingle();

  if (productError) {
    console.error(
      `STOCK_ALERT_NOTIFY_PRODUCT_FETCH_ERROR product_id=${productId} error=${productError.message}`,
    );
    return { sent: 0, failed: 0, skipped: 0 };
  }
  if (!productData) {
    // Product n'existe plus (cascade ON DELETE) — alertes déjà supprimées
    // côté DB par le CASCADE. Pas d'erreur sémantique.
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const product = productData as {
    id: string;
    nom: string;
    producer_id: string | null;
  };

  // 2. Fetch producer (best-effort pour slug URL + nom email)
  let producerSlug: string | null = null;
  let producerName: string | null = null;
  if (product.producer_id) {
    const { data: producerData, error: producerError } = await admin
      .from("producers")
      .select("slug, nom_exploitation")
      .eq("id", product.producer_id)
      .maybeSingle();
    if (producerError) {
      console.warn(
        `STOCK_ALERT_NOTIFY_PRODUCER_FETCH_WARN producer_id=${product.producer_id} error=${producerError.message}`,
      );
    } else if (producerData) {
      const row = producerData as {
        slug: string | null;
        nom_exploitation: string | null;
      };
      producerSlug = row.slug;
      producerName = row.nom_exploitation;
    }
  }

  // 3. Fetch alertes éligibles
  const { data: alertsData, error: alertsError } = await admin
    .from("product_stock_alerts")
    .select("id, email, unsubscribe_token, consumer_id")
    .eq("product_id", productId)
    .not("confirmed_at", "is", null)
    .is("notified_at", null)
    .is("unsubscribed_at", null);

  if (alertsError) {
    console.error(
      `STOCK_ALERT_NOTIFY_FETCH_ERROR product_id=${productId} error=${alertsError.message}`,
    );
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const alerts = (alertsData ?? []) as Array<{
    id: string;
    email: string;
    unsubscribe_token: string;
    consumer_id: string | null;
  }>;

  if (alerts.length === 0) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  // URL produit : si producer slug absent, fallback sur lien produit-only
  // (ne pointe pas vers une page valide, mais le produit existe → user
  // peut chercher manuellement). Cas dégénéré, ne devrait pas arriver.
  const productUrl = producerSlug
    ? `${NEXT_PUBLIC_APP_URL}/producteurs/${producerSlug}/produits/${product.id}`
    : `${NEXT_PUBLIC_APP_URL}/producteurs`;

  let sent = 0;
  let failed = 0;

  for (const alert of alerts) {
    const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/api/stock-alerts/unsubscribe?token=${alert.unsubscribe_token}`;

    const props = {
      productName: product.nom,
      productUrl,
      producerName,
      unsubscribeUrl,
    };

    const sendResult = await sendTemplate({
      to: alert.email,
      userId: alert.consumer_id,
      template: "stock-alert-back-in-stock",
      subject: backInStockSubject(props),
      element: <StockAlertBackInStock {...props} />,
      metadata: { product_id: productId, alert_id: alert.id },
    });

    if (!sendResult.ok) {
      failed++;
      console.error(
        `STOCK_ALERT_NOTIFY_SEND_ERROR alert_id=${alert.id} error=${sendResult.error}`,
      );
      continue;
    }

    const { error: updateError } = await admin
      .from("product_stock_alerts")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", alert.id);

    if (updateError) {
      failed++;
      console.error(
        `STOCK_ALERT_NOTIFY_UPDATE_ERROR alert_id=${alert.id} error=${updateError.message}`,
      );
      continue;
    }

    sent++;
  }

  return { sent, failed, skipped: 0 };
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchProducerForUser } from "@/lib/producers/context";
import { fetchProducerAlerts } from "@/lib/stock-alerts/fetch-producer-alerts";

// Server Component (pattern aligné /dashboard, /revenus). Fetch SSR :
//   1. session ou redirect /connexion
//   2. fetchProducerForUser (helper lib/producers/context.ts) ou redirect
//      /devenir-producteur si user n'a pas de profil producer
//   3. fetchProducerAlerts (helper PUSH 3) — retourne les produits avec
//      alertes actives (confirmed, non notifiées, non unsubscribed),
//      groupés + count + tri DESC + filter count > 0.
//
// Pas de composant *Client.tsx : la page est statique post-fetch (juste
// affichage de cards), pas d'interaction. Refresh = navigation.

export default async function ProducerAlertesStockPage() {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const admin = createSupabaseAdminClient();
  const producer = await fetchProducerForUser(admin, session.id);
  if (!producer) redirect("/devenir-producteur");

  const alerts = await fetchProducerAlerts(admin, producer.id);

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <header className="mb-8">
        <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
          Alertes stock
        </div>
        <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">
          Vos alertes en attente
        </h1>
        <p className="text-[14px] text-dark/60 mt-2 leading-relaxed max-w-2xl">
          Liste des produits que des consommateurs attendent au retour en
          stock. Réapprovisionnez via l&apos;onglet Catalogue (bouton{" "}
          <span className="text-terra-700 font-medium">Stock</span>) pour
          déclencher automatiquement l&apos;envoi des emails de notification.
        </p>
      </header>

      {alerts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dark/[0.06] p-12 text-center">
          <h3 className="font-serif text-[24px] text-green-900">
            Aucune alerte stock pour le moment.
          </h3>
          <p className="text-[14px] text-dark/60 mt-2 max-w-xl mx-auto leading-relaxed">
            Les consommateurs pourront s&apos;inscrire à l&apos;alerte sur la
            fiche produit dès qu&apos;un de vos produits est en rupture (stock
            à 0). Plus vos produits sont attendus, plus la liste se remplit
            ici — un bon signal pour orienter votre planification.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <article
              key={alert.product_id}
              className="bg-white rounded-2xl border border-dark/[0.06] p-5 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <h3 className="font-serif text-[20px] text-green-900 leading-tight truncate">
                  {alert.product_name}
                </h3>
                <p className="text-[13px] text-dark/60 mt-1">
                  {alert.count}{" "}
                  {alert.count === 1
                    ? "personne attend"
                    : "personnes attendent"}{" "}
                  le retour en stock
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="font-serif text-[28px] text-terra-700 tabular-nums">
                  {alert.count}
                </span>
                <Link
                  href="/catalogue"
                  className="text-[13px] text-green-700 font-medium hover:text-green-900 whitespace-nowrap"
                >
                  Réapprovisionner →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

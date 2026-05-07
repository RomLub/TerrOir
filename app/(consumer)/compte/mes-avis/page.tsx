import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { StarRating } from "@/components/ui/star-rating";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProducerEmbed =
  | { nom_exploitation: string | null; slug: string | null }
  | Array<{ nom_exploitation: string | null; slug: string | null }>
  | null;

type OrderRow = {
  id: string;
  code_commande: string;
  completed_at: string | null;
  montant_total: number | string | null;
  producers: ProducerEmbed;
};

type ReviewRow = {
  id: string;
  note: number;
  commentaire: string | null;
  statut: string;
  created_at: string;
  order_id: string;
  producers: ProducerEmbed;
};

function pickProducer(p: ProducerEmbed) {
  return Array.isArray(p) ? p[0] : p;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function statutLabel(statut: string): { label: string; className: string } {
  if (statut === "approved" || statut === "published") {
    return {
      label: "Publié",
      className: "bg-green-100 text-green-800",
    };
  }
  if (statut === "rejected") {
    return { label: "Refusé", className: "bg-red-100 text-red-800" };
  }
  return {
    label: "En modération",
    className: "bg-amber-100 text-amber-800",
  };
}

export default async function MesAvisPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const sp = await props.searchParams;
  const success = sp.success === "1";

  const admin = createSupabaseAdminClient();

  const [{ data: ordersData }, { data: reviewsData }] = await Promise.all([
    admin
      .from("orders")
      .select(
        "id, code_commande, completed_at, montant_total, producers:producer_id ( nom_exploitation, slug )",
      )
      .eq("consumer_id", session.id)
      .eq("statut", "completed")
      .order("completed_at", { ascending: false }),
    admin
      .from("reviews")
      .select(
        "id, note, commentaire, statut, created_at, order_id, producers:producer_id ( nom_exploitation, slug )",
      )
      .eq("consumer_id", session.id)
      .order("created_at", { ascending: false }),
  ]);

  const orders = (ordersData ?? []) as OrderRow[];
  const reviews = (reviewsData ?? []) as ReviewRow[];

  const reviewedOrderIds = new Set(reviews.map((r) => r.order_id));
  const ordersToReview = orders.filter((o) => !reviewedOrderIds.has(o.id));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold text-terra-900 sm:text-3xl">
        Mes avis
      </h1>
      <p className="mt-2 text-sm text-terroir-muted">
        Note les producteurs chez qui tu as commandé. Tes avis sont modérés
        avant publication pour garantir la qualité de la communauté TerrOir.
      </p>

      {success ? (
        <div
          role="status"
          className="mt-6 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800"
        >
          Merci ! Ton avis a bien été enregistré et sera publié après
          modération.
        </div>
      ) : null}

      <section className="mt-8" aria-labelledby="a-donner-heading">
        <h2
          id="a-donner-heading"
          className="text-lg font-semibold text-terra-900"
        >
          À donner
        </h2>
        {ordersToReview.length === 0 ? (
          <p className="mt-3 rounded-md border border-terroir-border bg-terroir-cream/40 p-4 text-sm text-terroir-muted">
            Tu es à jour ! Plus aucun avis à donner pour le moment.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {ordersToReview.map((order) => {
              const producer = pickProducer(order.producers);
              const exploitation =
                producer?.nom_exploitation ?? "Producteur inconnu";
              return (
                <li
                  key={order.id}
                  className="flex flex-col gap-3 rounded-md border border-terroir-border bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-base font-medium text-terra-900">
                      {exploitation}
                    </p>
                    <p className="mt-0.5 text-xs text-terroir-muted">
                      Commande {order.code_commande}
                      {order.completed_at
                        ? ` · retirée le ${formatDate(order.completed_at)}`
                        : ""}
                    </p>
                  </div>
                  <Link
                    href={`/compte/mes-avis/${order.id}/nouveau`}
                    className="inline-flex items-center justify-center rounded-md bg-terra-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terra-800"
                  >
                    Laisser un avis
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="donnes-heading">
        <h2
          id="donnes-heading"
          className="text-lg font-semibold text-terra-900"
        >
          Donnés
        </h2>
        {reviews.length === 0 ? (
          <p className="mt-3 rounded-md border border-terroir-border bg-terroir-cream/40 p-4 text-sm text-terroir-muted">
            Tu n&rsquo;as pas encore donné d&rsquo;avis.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {reviews.map((review) => {
              const producer = pickProducer(review.producers);
              const exploitation =
                producer?.nom_exploitation ?? "Producteur inconnu";
              const status = statutLabel(review.statut);
              return (
                <li
                  key={review.id}
                  className="rounded-md border border-terroir-border bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-base font-medium text-terra-900">
                      {exploitation}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-terroir-muted">
                    <StarRating value={review.note} readOnly size="sm" />
                    <span>· {formatDate(review.created_at)}</span>
                  </div>
                  {review.commentaire ? (
                    <p className="mt-2 text-sm text-terra-900 whitespace-pre-line">
                      {review.commentaire}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

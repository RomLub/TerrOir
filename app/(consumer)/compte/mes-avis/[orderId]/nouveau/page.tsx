import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SectionSkeleton } from "../../../_components/ContentSkeletons";
import { AvisForm } from "./AvisForm";


type ProducerEmbed =
  | { nom_exploitation: string | null }
  | Array<{ nom_exploitation: string | null }>
  | null;

type OrderRow = {
  id: string;
  code_commande: string;
  consumer_id: string;
  statut: string;
  producers: ProducerEmbed;
};

function pickProducer(p: ProducerEmbed) {
  return Array.isArray(p) ? p[0] : p;
}

// Coquille SYNCHRONE (streaming Suspense) : la page retourne immédiatement le
// <Suspense> + skeleton, SANS aucun await en tête (ni session, ni params —
// donnée de requête). Tout l'accès dynamique vit dans NouvelAvisGate, sous
// le <Suspense>.
export default function NouvelAvisPage(props: {
  params: Promise<{ orderId: string }>;
}) {
  return (
    <Suspense fallback={<SectionSkeleton rows={3} />}>
      <NouvelAvisGate paramsPromise={props.params} />
    </Suspense>
  );
}

async function NouvelAvisGate(props: {
  paramsPromise: Promise<{ orderId: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const { orderId } = await props.paramsPromise;

  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("orders")
    .select(
      "id, code_commande, consumer_id, statut, producers:producer_id ( nom_exploitation )",
    )
    .eq("id", orderId)
    .maybeSingle();

  const order = data as OrderRow | null;
  if (!order) {
    notFound();
  }
  if (order.consumer_id !== session.id) {
    redirect("/compte/mes-avis");
  }
  if (order.statut !== "completed") {
    redirect("/compte/mes-avis");
  }

  // Si une review existe déjà → retour à la liste
  const { data: existingReview } = await admin
    .from("reviews")
    .select("id")
    .eq("order_id", order.id)
    .maybeSingle();
  if (existingReview) {
    redirect("/compte/mes-avis");
  }

  const producer = pickProducer(order.producers);
  const exploitation = producer?.nom_exploitation ?? "Producteur";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold text-terra-900 sm:text-3xl">
        Laisser un avis
      </h1>
      <p className="mt-2 text-sm text-terroir-muted">
        Ton avis sera modéré par l&rsquo;équipe TerrOir avant publication. Sois
        précis et bienveillant — c&rsquo;est ce qui aide les autres consumers
        à choisir.
      </p>

      <AvisForm
        orderId={order.id}
        exploitation={exploitation}
        codeCommande={order.code_commande}
      />
    </main>
  );
}

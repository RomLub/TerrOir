import { Suspense } from "react";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { MetricCard } from "@/components/ui/metric-card";
import {
  fetchPendingReviews,
  fetchPublishedResponses,
} from "@/lib/admin/reviews";
import { SectionSkeleton } from "../_components/ContentSkeletons";
import { AvisModerationClient } from "./_components/AvisModerationClient";

// Page admin /admin/avis — modération avis consumer + réponses producer.
//
// Server Component dynamique : fetch via service_role (cf.
// lib/admin/reviews/fetch-reviews.ts). Le bug AUDIT_ADMIN § 4.5
// (reviews `pending` invisibles via RLS — table sans policy admin)
// est résolu par cette PR : la lecture passe maintenant par le bypass
// service_role qui voit tous les statuts. L'ancien fetch browser-client
// + RLS retournait 0 row dès qu'un consumer postait un avis pending.
//
// Interactions (boutons publier / rejeter / supprimer réponse) déléguées
// à AvisModerationClient (sub-client). Les API routes /api/admin/reviews/
// [id]/moderate et /api/admin/reviews/[id]/response font les WRITE via
// service_role + audit log.


// Coquille SYNCHRONE (streaming Suspense) : aucun accès dynamique en tête, le titre
// admin s'affiche immédiatement, la modération (fetch avis pending + réponses
// publiées) est streamée via <Suspense>. Le compteur « En attente » et l'erreur
// éventuelle dépendent du fetch, donc le AdminPageHeader complet vit dans le
// contenu streamé.
export default function AdminAvisPage() {
  return (
    <Suspense fallback={<AvisFallback />}>
      <AvisContent />
    </Suspense>
  );
}

function AvisFallback() {
  return (
    <div>
      <AdminPageHeader
        eyebrow="Modération"
        title="Avis à modérer"
        subtitle="Validez chaque avis avant publication sur la page du producteur."
      />
      <SectionSkeleton rows={6} />
    </div>
  );
}

// Exporté pour les tests unitaires : c'est ici que vivent le fetch + le rendu
// data. La page reste une coquille <Suspense> (fallback = header + skeleton).
export async function AvisContent() {
  const [pendingRes, responsesRes] = await Promise.all([
    fetchPendingReviews(),
    fetchPublishedResponses(),
  ]);

  // Erreur de fetch (DB down, service_role rotated incorrectly) : on
  // affiche dans le header pour signal admin/SRE clair, sans 500 la page.
  const errorMsg = pendingRes.error ?? responsesRes.error ?? null;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Modération"
        title="Avis à modérer"
        subtitle="Validez chaque avis avant publication sur la page du producteur."
        error={errorMsg}
        right={
          <MetricCard size="sm" label="En attente" value={pendingRes.rows.length} />
        }
      />

      <AvisModerationClient
        initialPending={pendingRes.rows}
        initialResponses={responsesRes.rows}
      />
    </div>
  );
}

import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchProducerInterestsList } from "@/lib/admin/producer-interests/fetch";
import { ListSkeleton } from "../_components/ContentSkeletons";
import { ProducerInterestsClient } from "./_components/ProducerInterestsClient";
import type { Lead } from "./_components/types";

// Server Component — refactor PR1 admin-pattern-uniform (2026-05-13).
//
// Auparavant la page était entièrement 'use client' avec un
// createSupabaseBrowserClient() qui s'appuyait sur la policy RLS admin
// pour lire la table producer_interests. Désormais on SSR la lecture via
// service_role (cohérent avec /suivi-commandes et la doctrine harmonisée
// des READ admin SSR documentée dans AUDIT_ADMIN § 4.5 / § 7.1).
//
// Le layout (admin)/layout.tsx fait déjà le check session + isAdmin + host
// — pas de redirect supplémentaire ici, conforme au pattern des autres
// pages SSR admin.
//
// Mutations : passent par les API routes /api/admin/producer-interests/[id]
// + /[id]/statut. Audit log obligatoire côté serveur.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Coquille synchrone : la liste des leads (fetch service_role) est streamée
// via <Suspense> pour que le shell admin reste fixe.
export default async function AdminProducerInterestsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <ProducerInterestsContent />
    </Suspense>
  );
}

// Exporté pour les tests unitaires : c'est ici que vit la logique data (fetch
// service_role + propagation au client). La page reste une coquille <Suspense>.
export async function ProducerInterestsContent() {
  const admin = createSupabaseAdminClient();

  let initialLeads: Lead[] = [];
  let initialError: string | null = null;
  try {
    initialLeads = await fetchProducerInterestsList(admin);
  } catch (err) {
    initialError = (err as Error).message;
  }

  return (
    <ProducerInterestsClient
      initialLeads={initialLeads}
      initialError={initialError}
    />
  );
}

import { Suspense } from 'react';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { parseCursor, type ParsedCursor } from '@/lib/pagination/cursor';
import { fetchAdminProducersList } from '@/lib/admin/producers/fetch';
import {
  parseProducerStatusFilter,
  type ProducerStatusFilter,
} from '@/lib/admin/producers/types';
import { ListSkeleton } from '../_components/ContentSkeletons';
import { GestionProducteursClient } from './_components/GestionProducteursClient';

// Server Component admin /gestion-producteurs (PR refactor/admin-pattern-uniform).
// Refactor du pattern WRITE/READ identifié dans l'audit § 7.2 : on bascule
// d'un Client Component complet (browser-client + RLS admin all) vers un
// Server Component + service_role + API route pour les mutations. Le sub-
// client `GestionProducteursClient` gère les interactions UI (filtres tabs,
// modals, pagination cursor déclenchée via Link).
//
// (admin)/layout.tsx fait déjà le check session + isAdmin + host. La query
// producers tourne ici en SSR via service_role (cohérent suivi-commandes,
// legal-compliance). Les WRITE (statut) passent maintenant par
// /api/admin/producers/[id]/statut (auth check + audit log obligatoire).

type SearchParams = {
  before?: string;
  before_id?: string;
  show_all?: string;
  invite?: string;
  user_id?: string;
  // Chantier 4 — deep-link filtre statut (cockpit dashboard « Producteurs à
  // valider » → ?status=pending, journal d'audit, etc.).
  status?: string;
};

// Coquille SYNCHRONE (streaming Suspense) : aucun accès dynamique en tête. Le
// searchParams (donnée de requête) est lu DANS le Gate, à l'intérieur du
// <Suspense>, pour que le cadre admin (header + sidebar) s'affiche tout de
// suite ; la liste producteurs (fetch service_role) reste streamée.
export default function AdminProducteursPage(
  props: { searchParams: Promise<SearchParams> },
) {
  return (
    <Suspense fallback={<ListSkeleton rows={8} />}>
      <ProducteursGate searchParams={props.searchParams} />
    </Suspense>
  );
}

// Gate DANS le <Suspense> : await + parse du searchParams, puis délègue au
// contenu data. Séparé de ProducteursContent pour garder ce dernier testable
// unitairement avec des props déjà résolues.
async function ProducteursGate({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const showAll = sp.show_all === '1';
  const initialStatusFilter = parseProducerStatusFilter(sp.status);

  // Réutilise parseCursor du helper canonique (lib/pagination/cursor). On
  // doit lui passer un objet `{ get(name) }` — un simple wrapper sur l'objet
  // searchParams fait l'affaire.
  const cursor = parseCursor({
    get(name: string) {
      return (sp as Record<string, string | undefined>)[name] ?? null;
    },
  });

  return (
    <ProducteursContent
      cursor={cursor}
      showAll={showAll}
      initialStatusFilter={initialStatusFilter}
    />
  );
}

// Exporté pour les tests unitaires : c'est ici que vit la logique data
// (fetch service_role + propagation des props au client). La page n'est plus
// qu'une coquille <Suspense> (plumbing de rendu, non testée unitairement).
export async function ProducteursContent({
  cursor,
  showAll,
  initialStatusFilter,
}: {
  cursor: ParsedCursor;
  showAll: boolean;
  initialStatusFilter: ProducerStatusFilter;
}) {
  const admin = createSupabaseAdminClient();
  const { rows, total, nextCursor, error } = await fetchAdminProducersList(admin, {
    cursor,
    includeDraftsAndDeleted: showAll,
  });

  return (
    <GestionProducteursClient
      initialProducers={rows}
      initialTotal={total}
      initialNextCursor={nextCursor}
      initialError={error}
      showAll={showAll}
      isPaginated={cursor.before !== null}
      initialStatusFilter={initialStatusFilter}
    />
  );
}

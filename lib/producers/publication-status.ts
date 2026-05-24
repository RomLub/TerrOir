import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Lecture du statut de publication (ADR-0011) via la RPC read-only
// get_publication_status (mirroir des 6 critères de request_publication).
// Sert la checklist de mise en ligne côté producteur.

export type PublicationCriteria = {
  description: boolean;
  photo_principale: boolean;
  localisation: boolean;
  stripe: boolean;
  product_with_photo: boolean;
  open_slot: boolean;
};

export type PublicationStatus = {
  found: boolean;
  statut: string | null;
  alreadyPublic: boolean;
  publicationRequested: boolean;
  criteria: PublicationCriteria;
  missing: string[];
  allOk: boolean;
};

const EMPTY_CRITERIA: PublicationCriteria = {
  description: false,
  photo_principale: false,
  localisation: false,
  stripe: false,
  product_with_photo: false,
  open_slot: false,
};

const NOT_FOUND: PublicationStatus = {
  found: false,
  statut: null,
  alreadyPublic: false,
  publicationRequested: false,
  criteria: EMPTY_CRITERIA,
  missing: [],
  allOk: false,
};

export async function getPublicationStatus(
  userId: string,
): Promise<PublicationStatus> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_publication_status", {
    p_user_id: userId,
  });

  if (error || !data || (data as { found?: boolean }).found !== true) {
    return NOT_FOUND;
  }

  const d = data as {
    statut: string | null;
    already_public: boolean;
    publication_requested: boolean;
    criteria: Partial<PublicationCriteria>;
    missing: string[];
    all_ok: boolean;
  };

  return {
    found: true,
    statut: d.statut ?? null,
    alreadyPublic: !!d.already_public,
    publicationRequested: !!d.publication_requested,
    criteria: { ...EMPTY_CRITERIA, ...d.criteria },
    missing: Array.isArray(d.missing) ? d.missing : [],
    allOk: !!d.all_ok,
  };
}

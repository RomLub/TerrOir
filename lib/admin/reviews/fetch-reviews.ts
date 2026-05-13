import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mapPendingReview, mapReviewWithResponse } from "./format";
import type {
  AdminReviewRow,
  AdminReviewWithResponseRow,
  ReviewPendingDbRow,
  ReviewWithResponseDbRow,
} from "./types";

// Helpers fetch admin reviews. Pattern READ admin = service_role (cf.
// AUDIT_ADMIN § 4.5 : table public.reviews sans policy admin, seul le
// bypass RLS permet à l'admin de voir les reviews statut='pending'). Bug
// résolu par cette PR — avant, /admin/avis fetchait via browser client +
// RLS et les pending étaient invisibles par construction.
//
// Contrat fail-safe : un échec de fetch retourne []/{rows:[], error} pour
// laisser la page rendre dans un état dégradé visible (cf. AdminPageHeader
// `error`). Pas de throw — la page admin ne doit jamais 500.

// Un SupabaseClient typé est lourd à matcher dans les mocks Vitest. On
// déclare une signature minimale qui ne contraint que ce dont les helpers
// se servent — laisse les tests fournir un mock partiel.
type AdminClientLike = ReturnType<typeof createSupabaseAdminClient>;

export type FetchReviewsResult<T> = {
  rows: T[];
  error: string | null;
};

const PENDING_SELECT = `
  id, note, commentaire, created_at,
  consumer:consumer_id ( prenom, nom ),
  producer:producer_id ( nom_exploitation, slug )
`;

const WITH_RESPONSE_SELECT = `
  id, note, commentaire, created_at,
  producer_response, producer_response_at, producer_response_status,
  consumer:consumer_id ( prenom, nom ),
  producer:producer_id ( nom_exploitation, slug )
`;

export async function fetchPendingReviews(
  client?: AdminClientLike,
): Promise<FetchReviewsResult<AdminReviewRow>> {
  const admin = client ?? createSupabaseAdminClient();
  const { data, error } = await admin
    .from("reviews")
    .select(PENDING_SELECT)
    .eq("statut", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn(
      `[ADMIN_REVIEWS_FETCH_PENDING_WARN] error=${error.message}`,
    );
    return { rows: [], error: error.message };
  }

  const raw = (data ?? []) as unknown as ReviewPendingDbRow[];
  return { rows: raw.map(mapPendingReview), error: null };
}

export async function fetchPublishedResponses(
  client?: AdminClientLike,
  limit = 50,
): Promise<FetchReviewsResult<AdminReviewWithResponseRow>> {
  const admin = client ?? createSupabaseAdminClient();
  const { data, error } = await admin
    .from("reviews")
    .select(WITH_RESPONSE_SELECT)
    .eq("statut", "published")
    .eq("producer_response_status", "published")
    .not("producer_response", "is", null)
    .order("producer_response_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.warn(
      `[ADMIN_REVIEWS_FETCH_RESPONSES_WARN] error=${error.message}`,
    );
    return { rows: [], error: error.message };
  }

  const raw = (data ?? []) as unknown as ReviewWithResponseDbRow[];
  return { rows: raw.map(mapReviewWithResponse), error: null };
}

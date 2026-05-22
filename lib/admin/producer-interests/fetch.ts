import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRODUCER_INTEREST_COLUMNS,
  type AdminProducerInterestRow,
  type LeadFollowupRow,
  type LeadSource,
} from "./types";

// Helper de lecture admin pour la table public.producer_interests.
//
// Architecture : prend un SupabaseClient en argument (typé service_role
// côté appelant via createSupabaseAdminClient) plutôt que de l'instancier
// lui-même. Avantages : (1) testabilité par injection mock ; (2) cohérence
// avec lib/products/admin/categories.ts pattern.
//
// Lecture admin = service_role bypass plutôt que RLS (cohérent avec le
// pattern SSR /suivi-commandes et la doctrine harmonisée de la PR refactor
// admin pattern uniform — toutes les pages SSR admin lisent via service_role,
// même si une policy admin RLS existe, pour éviter le risque de régression
// silencieuse cf. AUDIT_ADMIN § 4.5).

export async function fetchProducerInterestsList(
  admin: SupabaseClient,
): Promise<AdminProducerInterestRow[]> {
  const { data, error } = await admin
    .from("producer_interests")
    .select(PRODUCER_INTEREST_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) {
    console.error(
      `[PRODUCER_INTERESTS_FETCH_ERROR] error=${error.message}`,
    );
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as AdminProducerInterestRow[];
}

export type AdminLeadsFilter = {
  source?: LeadSource;
  step?: number;
  assignedTo?: string;
  limit?: number;
};

// Listing filtré pour GET /api/admin/leads (chantier 3, Phase 2.1).
// Filtres optionnels source / step / referent. Tri created_at DESC.
export async function fetchAdminLeadsList(
  admin: SupabaseClient,
  filter: AdminLeadsFilter = {},
): Promise<AdminProducerInterestRow[]> {
  let query = admin
    .from("producer_interests")
    .select(PRODUCER_INTEREST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(Math.min(filter.limit ?? 200, 500));

  if (filter.source) query = query.eq("source", filter.source);
  if (typeof filter.step === "number") query = query.eq("current_step", filter.step);
  if (filter.assignedTo) query = query.eq("assigned_to", filter.assignedTo);

  const { data, error } = await query;
  if (error) {
    console.error(`[ADMIN_LEADS_LIST_ERROR] error=${error.message}`);
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as AdminProducerInterestRow[];
}

export async function getProducerInterest(
  admin: SupabaseClient,
  id: string,
): Promise<AdminProducerInterestRow | null> {
  const { data, error } = await admin
    .from("producer_interests")
    .select(PRODUCER_INTEREST_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(
      `[PRODUCER_INTEREST_GET_ERROR] id=${id} error=${error.message}`,
    );
    throw new Error(error.message);
  }
  return (data as AdminProducerInterestRow | null) ?? null;
}

// Historique des interactions d'un lead (producer_interest_followups),
// chronologie décroissante. Consommé par la page détail (Phase 3).
export async function fetchLeadFollowups(
  admin: SupabaseClient,
  leadId: string,
): Promise<LeadFollowupRow[]> {
  const { data, error } = await admin
    .from("producer_interest_followups")
    .select(
      "id, lead_id, occurred_at, channel, direction, is_automatic, relance_step, note, created_by, created_at",
    )
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: false });
  if (error) {
    console.error(`[LEAD_FOLLOWUPS_FETCH_ERROR] lead=${leadId} error=${error.message}`);
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as LeadFollowupRow[];
}

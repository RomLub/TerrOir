import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCursor, type ParsedCursor } from "@/lib/pagination/cursor";
import { formatDateFr } from "@/lib/format/date";
import {
  PLAN_LABEL,
  type AdminProducerRow,
  type ProducerStatus,
} from "./types";

// Helper service_role pour la page admin /gestion-producteurs.
// Centralise la query producers + jointure users.email + pagination cursor
// + count exact. Extrait du browser-client de l'ancienne page CSR pour
// passer en SSR avec service_role (PR refactor/admin-pattern-uniform, suite
// audit § 7.2 — pattern WRITE incohérent fixé par centralisation READ
// côté serveur via service_role).
//
// Limite hardcodée 100 — alignée sur l'ancienne page (audit perf-postgres-
// 2026-05-05 M-2 + NEW-1) : pagination cursor (created_at DESC + id DESC
// tie-breaker). Le count(*) tourne en parallèle pour le banner
// ListingHeader.

const PAGE_SIZE = 100;

type FetchAdminProducersOptions = {
  // Cursor "before" parsé depuis les search params (created_at + id).
  cursor: ParsedCursor;
  // Quand false, exclut les statuts 'draft' et 'deleted' (toggle UI). True
  // ramène tout — utile pour debug forensique post-RGPD.
  includeDraftsAndDeleted: boolean;
};

export type FetchAdminProducersResult = {
  rows: AdminProducerRow[];
  total: number;
  nextCursor: { created_at: string; id: string } | null;
  error: string | null;
};

// Shape Supabase brute de la query — capture la jointure non-aplatie qu'on
// remappe ensuite vers AdminProducerRow.
type RawProducerRow = {
  id: string;
  slug: string;
  nom_exploitation: string;
  commune: string | null;
  code_postal: string | null;
  statut: ProducerStatus;
  abonnement_niveau: string | null;
  created_at: string;
  user_id: string | null;
  bio: boolean | null;
  bio_validated_at: string | null;
  publication_requested_at: string | null;
  // Supabase remonte la jointure 1:1 soit en objet, soit en array selon les
  // versions du client (compat ascendante). On normalise dans le mapper.
  // public.users (PAS auth.users) → jointure embarquée PostgREST OK.
  user: RawUserJoin | RawUserJoin[] | null;
};

type RawUserJoin = {
  email: string | null;
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
};

export async function fetchAdminProducersList(
  admin: SupabaseClient,
  opts: FetchAdminProducersOptions,
): Promise<FetchAdminProducersResult> {
  let itemsQuery = admin
    .from("producers")
    .select(
      "id, slug, nom_exploitation, commune, code_postal, statut, abonnement_niveau, created_at, user_id, bio, bio_validated_at, publication_requested_at, user:user_id ( email, prenom, nom, telephone )",
    );
  let countQuery = admin
    .from("producers")
    .select("id", { count: "exact", head: true });

  if (!opts.includeDraftsAndDeleted) {
    itemsQuery = itemsQuery.neq("statut", "draft").neq("statut", "deleted");
    countQuery = countQuery.neq("statut", "draft").neq("statut", "deleted");
  }

  const finalItemsQuery = applyCursor(itemsQuery, opts.cursor)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  const [itemsRes, countRes] = await Promise.all([
    finalItemsQuery,
    countQuery,
  ]);

  if (itemsRes.error) {
    return { rows: [], total: 0, nextCursor: null, error: itemsRes.error.message };
  }
  if (countRes.error) {
    return { rows: [], total: 0, nextCursor: null, error: countRes.error.message };
  }

  const data = (itemsRes.data ?? []) as unknown as RawProducerRow[];

  const rows: AdminProducerRow[] = data.map((p) => {
    const user = Array.isArray(p.user) ? p.user[0] : p.user;
    const cityParts = [
      p.commune,
      p.code_postal ? `(${p.code_postal.slice(0, 2)})` : null,
    ].filter(Boolean);
    const contactName =
      [user?.prenom, user?.nom].filter(Boolean).join(" ").trim() || "—";
    return {
      id: p.id,
      slug: p.slug,
      name: p.nom_exploitation,
      city: cityParts.join(" ") || "—",
      status: p.statut,
      plan: PLAN_LABEL[p.abonnement_niveau ?? ""] ?? "—",
      joinedAt: formatDateFr(p.created_at),
      email: user?.email ?? "—",
      contactName,
      phone: user?.telephone ?? null,
      userId: p.user_id ?? null,
      publicationRequested:
        p.publication_requested_at != null && p.statut !== "public",
      bioPending: Boolean(p.bio) && p.bio_validated_at == null,
      bioValidated: Boolean(p.bio) && p.bio_validated_at != null,
    };
  });

  // Cursor exposé seulement si on a rempli exactement PAGE_SIZE rows — sinon
  // c'est la dernière page (cohérent ancien comportement page CSR).
  const last =
    data.length === PAGE_SIZE
      ? (data[PAGE_SIZE - 1] as { id: string; created_at: string })
      : null;

  return {
    rows,
    total: countRes.count ?? 0,
    nextCursor: last ? { created_at: last.created_at, id: last.id } : null,
    error: null,
  };
}

export const ADMIN_PRODUCERS_PAGE_SIZE = PAGE_SIZE;

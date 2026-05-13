import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCursor, type ParsedCursor } from "@/lib/pagination/cursor";
import {
  type AdminInvitationRow,
  type InvitationStatus,
  type InvitationStatusFilter,
} from "./types";

// Helper service_role pour la page admin /invitations (chantier PR3
// feature/admin-new-surfaces). Centralise la query producer_invitations
// + jointure admin_users.email + filtres status computed + filtres date
// + pagination cursor + count exact.
//
// Pattern strictement aligné sur `lib/admin/producers/fetch.ts` (PR1) :
// service_role, cursor (created_at DESC + id DESC tie-breaker), limite
// hardcodée 50 (volume invitations attendu plus faible que producers).
//
// IMPORTANT — producer_invitations n'a pas de colonne `status`. Le filtre
// status est traduit en conditions SQL équivalentes :
//   - sent     = used_at IS NULL AND expires_at >= now() AND revoked_at IS NULL
//   - consumed = used_at IS NOT NULL
//   - expired  = used_at IS NULL AND expires_at < now() AND revoked_at IS NULL
//   - revoked  = revoked_at IS NOT NULL AND used_at IS NULL
//
// Le statut affiché par la table est COMPUTED par mapRowStatus(), avec
// précédence consumed > revoked > expired > sent (defensive : si une row
// historique a `used_at` ET `revoked_at` malgré le CHECK DB, on affiche
// consumed — état métier dominant).

const PAGE_SIZE = 50;

type FetchAdminInvitationsOptions = {
  // Cursor "before" parsé depuis les search params (created_at + id).
  cursor: ParsedCursor;
  // Filtre status computed. 'all' = pas de filtre statut.
  status: InvitationStatusFilter;
  // Filtre date sur created_at. Bornes ISO (string). Inclusifs.
  from: string | null;
  to: string | null;
  // Source explicite de `now()` pour rendre les filtres expired/sent
  // testables sans dépendre de l'horloge système. Optionnel — défaut Date.now.
  now?: Date;
};

export type FetchAdminInvitationsResult = {
  rows: AdminInvitationRow[];
  total: number;
  nextCursor: { created_at: string; id: string } | null;
  error: string | null;
};

// Shape Supabase brute de la query — capture la jointure non-aplatie qu'on
// remappe ensuite vers AdminInvitationRow. La jointure 1:1 sur created_by
// peut remonter en objet ou en array selon la version du client (cf.
// fetch.ts producers — même précaution).
type RawInvitationRow = {
  id: string;
  email: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
  creator:
    | { email: string | null }
    | Array<{ email: string | null }>
    | null;
};

// Mapping computed status. Précédence (defensive) :
//   1. used_at IS NOT NULL  → consumed
//   2. revoked_at IS NOT NULL → revoked
//   3. expires_at < now()   → expired
//   4. else                 → sent
// Si une row corrompue a `used_at` ET `revoked_at` (malgré le CHECK), on
// renvoie `consumed` — état métier dominant.
export function mapRowStatus(
  row: Pick<RawInvitationRow, "used_at" | "expires_at" | "revoked_at">,
  now: Date,
): InvitationStatus {
  if (row.used_at !== null) return "consumed";
  if (row.revoked_at !== null) return "revoked";
  if (new Date(row.expires_at).getTime() < now.getTime()) return "expired";
  return "sent";
}

export async function fetchAdminInvitationsList(
  admin: SupabaseClient,
  opts: FetchAdminInvitationsOptions,
): Promise<FetchAdminInvitationsResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  // SELECT initial avec jointure admin_users via FK created_by.
  let itemsQuery = admin
    .from("producer_invitations")
    .select(
      "id, email, expires_at, used_at, revoked_at, created_at, created_by, creator:created_by ( email )",
    );
  let countQuery = admin
    .from("producer_invitations")
    .select("id", { count: "exact", head: true });

  // Filtres status — traduction directe vers conditions SQL équivalentes.
  // On applique les MÊMES conditions sur items et count pour cohérence
  // displayed/total dans le ListingHeader.
  if (opts.status === "sent") {
    itemsQuery = itemsQuery
      .is("used_at", null)
      .gte("expires_at", nowIso)
      .is("revoked_at", null);
    countQuery = countQuery
      .is("used_at", null)
      .gte("expires_at", nowIso)
      .is("revoked_at", null);
  } else if (opts.status === "consumed") {
    itemsQuery = itemsQuery.not("used_at", "is", null);
    countQuery = countQuery.not("used_at", "is", null);
  } else if (opts.status === "expired") {
    itemsQuery = itemsQuery
      .is("used_at", null)
      .lt("expires_at", nowIso)
      .is("revoked_at", null);
    countQuery = countQuery
      .is("used_at", null)
      .lt("expires_at", nowIso)
      .is("revoked_at", null);
  } else if (opts.status === "revoked") {
    itemsQuery = itemsQuery.not("revoked_at", "is", null).is("used_at", null);
    countQuery = countQuery.not("revoked_at", "is", null).is("used_at", null);
  }
  // status === 'all' → pas de filtre statut.

  // Filtres date sur created_at. Bornes inclusives.
  if (opts.from) {
    itemsQuery = itemsQuery.gte("created_at", opts.from);
    countQuery = countQuery.gte("created_at", opts.from);
  }
  if (opts.to) {
    itemsQuery = itemsQuery.lte("created_at", opts.to);
    countQuery = countQuery.lte("created_at", opts.to);
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

  const data = (itemsRes.data ?? []) as unknown as RawInvitationRow[];

  const rows: AdminInvitationRow[] = data.map((inv) => {
    const creator = Array.isArray(inv.creator) ? inv.creator[0] : inv.creator;
    return {
      id: inv.id,
      email: inv.email,
      status: mapRowStatus(inv, now),
      createdAt: inv.created_at,
      expiresAt: inv.expires_at,
      usedAt: inv.used_at,
      revokedAt: inv.revoked_at,
      createdByEmail: creator?.email ?? null,
    };
  });

  // Cursor exposé seulement si on a rempli exactement PAGE_SIZE rows.
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

export const ADMIN_INVITATIONS_PAGE_SIZE = PAGE_SIZE;

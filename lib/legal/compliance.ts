import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { LEGAL_VERSIONS } from "./versions";

// Helpers backend conformité CGU. Pilote la vue admin /admin/legal-compliance
// (pré-launch : suivi des 11 users existants pré-2026-05-06 sans
// cgu_accepted_at peuplé) et préfigure le chantier futur "popup
// réacceptation CGU" (utilisera getUserCGUStatus() côté middleware/page).
//
// Service-role obligatoire : la table public.users a une RLS "self read"
// (id = auth.uid()). L'admin doit voir TOUS les users → bypass nécessaire.
//
// Logique status :
//   - never_accepted   : cgu_accepted_at IS NULL (héritage pré-launch
//                        OU bug acceptation rétroactive auto cf. migration
//                        20260506131551).
//   - accepted_current : cgu_version = LEGAL_VERSIONS.CGU (à jour).
//   - accepted_outdated: cgu_accepted_at NOT NULL ET cgu_version != courante
//                        (cas futur après bump version 1.0 → 2.0).
//
// Pour V1 (LEGAL_VERSIONS.CGU = "1.0"), la catégorie accepted_outdated est
// vide par construction. Affichée quand même dans les stats pour valider
// la logique en preview du chantier 3 popup réacceptation.

export type CGUStatus =
  | "accepted_current"
  | "accepted_outdated"
  | "never_accepted";

export interface CGUComplianceStatus {
  status: CGUStatus;
  acceptedAt: Date | null;
  acceptedVersion: string | null;
  currentVersion: string;
  daysSinceAcceptance: number | null;
}

export interface UserComplianceRow {
  id: string;
  email: string;
  prenom: string | null;
  nom: string | null;
  createdAt: string;
  status: CGUStatus;
  acceptedAt: string | null;
  acceptedVersion: string | null;
  daysSinceAcceptance: number | null;
}

export interface ComplianceStats {
  total: number;
  acceptedCurrent: number;
  acceptedOutdated: number;
  neverAccepted: number;
}

export type StatusFilter = CGUStatus | "all";

export interface ListUsersFilters {
  status?: StatusFilter;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListUsersResult {
  users: UserComplianceRow[];
  total: number;
  page: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 50;

// Pure helper exposé pour tests et pour le re-mapping de rows DB sans
// re-tirer les champs depuis l'admin client.
export function computeCGUStatus(
  acceptedAt: string | null,
  acceptedVersion: string | null,
  now: Date = new Date(),
): CGUComplianceStatus {
  const currentVersion = LEGAL_VERSIONS.CGU;
  if (!acceptedAt || !acceptedVersion) {
    return {
      status: "never_accepted",
      acceptedAt: null,
      acceptedVersion: null,
      currentVersion,
      daysSinceAcceptance: null,
    };
  }
  const date = new Date(acceptedAt);
  const days = Math.floor(
    (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000),
  );
  return {
    status:
      acceptedVersion === currentVersion
        ? "accepted_current"
        : "accepted_outdated",
    acceptedAt: date,
    acceptedVersion,
    currentVersion,
    daysSinceAcceptance: days,
  };
}

export async function getUserCGUStatus(
  userId: string,
): Promise<CGUComplianceStatus | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("cgu_accepted_at, cgu_version")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return computeCGUStatus(
    (data as { cgu_accepted_at: string | null }).cgu_accepted_at,
    (data as { cgu_version: string | null }).cgu_version,
  );
}

export async function listUsersWithCGUStatus(
  filters: ListUsersFilters = {},
): Promise<ListUsersResult> {
  const admin = createSupabaseAdminClient();
  const limit = Math.max(1, filters.limit ?? DEFAULT_PAGE_SIZE);
  const offset = Math.max(0, filters.offset ?? 0);
  const status: StatusFilter = filters.status ?? "all";
  const search = filters.search?.trim() ?? "";

  let query = admin
    .from("users")
    .select(
      "id, email, prenom, nom, created_at, cgu_accepted_at, cgu_version",
      { count: "exact" },
    );

  if (status === "never_accepted") {
    query = query.is("cgu_accepted_at", null);
  } else if (status === "accepted_current") {
    query = query.eq("cgu_version", LEGAL_VERSIONS.CGU);
  } else if (status === "accepted_outdated") {
    query = query
      .not("cgu_accepted_at", "is", null)
      .neq("cgu_version", LEGAL_VERSIONS.CGU);
  }

  if (search) {
    // Échappement % et _ pour empêcher l'admin d'élargir involontairement
    // le pattern (un email contient rarement ces chars, mais paranoïa).
    const escaped = search.replace(/[%_\\]/g, (m) => `\\${m}`);
    query = query.ilike("email", `%${escaped}%`);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  type Row = {
    id: string;
    email: string;
    prenom: string | null;
    nom: string | null;
    created_at: string;
    cgu_accepted_at: string | null;
    cgu_version: string | null;
  };

  const users: UserComplianceRow[] = ((data ?? []) as Row[]).map((r) => {
    const computed = computeCGUStatus(r.cgu_accepted_at, r.cgu_version);
    return {
      id: r.id,
      email: r.email,
      prenom: r.prenom,
      nom: r.nom,
      createdAt: r.created_at,
      status: computed.status,
      acceptedAt: r.cgu_accepted_at,
      acceptedVersion: r.cgu_version,
      daysSinceAcceptance: computed.daysSinceAcceptance,
    };
  });

  const total = count ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = total === 0 ? 1 : Math.ceil(total / limit);

  return { users, total, page, totalPages };
}

export async function getCGUComplianceStats(): Promise<ComplianceStats> {
  const admin = createSupabaseAdminClient();

  // 4 head-only count queries en parallèle. head:true évite le transfert
  // des rows — seul le count remonte. Plus rapide qu'une seule query
  // GROUP BY car Supabase JS ne supporte pas natif un .group() server-side.
  const [totalRes, neverRes, currentRes, outdatedRes] = await Promise.all([
    admin.from("users").select("id", { count: "exact", head: true }),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .is("cgu_accepted_at", null),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("cgu_version", LEGAL_VERSIONS.CGU),
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .not("cgu_accepted_at", "is", null)
      .neq("cgu_version", LEGAL_VERSIONS.CGU),
  ]);

  if (totalRes.error) throw totalRes.error;
  if (neverRes.error) throw neverRes.error;
  if (currentRes.error) throw currentRes.error;
  if (outdatedRes.error) throw outdatedRes.error;

  return {
    total: totalRes.count ?? 0,
    neverAccepted: neverRes.count ?? 0,
    acceptedCurrent: currentRes.count ?? 0,
    acceptedOutdated: outdatedRes.count ?? 0,
  };
}

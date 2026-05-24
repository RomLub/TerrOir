import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateFr } from "@/lib/format/date";
import type { AdminPrivilege } from "./operations";

// Chantier 6 — liste des comptes administrateurs pour la page Admins
// (Gouvernance). service_role : admin_users n'a qu'une policy self-read.

export type AdminAccountRow = {
  id: string;
  email: string | null;
  fullName: string;
  privilege: AdminPrivilege;
  suspended: boolean;
  createdAt: string;
};

export type FetchAdminAccountsResult = {
  rows: AdminAccountRow[];
  error: string | null;
};

type RawAdmin = {
  id: string;
  email: string | null;
  prenom: string | null;
  nom: string | null;
  admin_privilege: AdminPrivilege;
  suspended_at: string | null;
  created_at: string;
};

export async function fetchAdminAccounts(
  admin: SupabaseClient,
): Promise<FetchAdminAccountsResult> {
  const { data, error } = await admin
    .from("admin_users")
    .select("id, email, prenom, nom, admin_privilege, suspended_at, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    return { rows: [], error: error.message };
  }

  const rows: AdminAccountRow[] = ((data ?? []) as RawAdmin[]).map((a) => ({
    id: a.id,
    email: a.email,
    fullName: [a.prenom, a.nom].filter(Boolean).join(" ").trim() || "—",
    privilege: a.admin_privilege,
    suspended: a.suspended_at != null,
    createdAt: formatDateFr(a.created_at),
  }));

  return { rows, error: null };
}

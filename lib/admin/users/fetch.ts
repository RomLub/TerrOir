import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCursor, type ParsedCursor } from "@/lib/pagination/cursor";
import { formatDateFr } from "@/lib/format/date";
import { escapeIlikeEmail } from "@/lib/supabase/escape-ilike";
import {
  deriveRole,
  type AdminUserDetail,
  type AdminUserNotification,
  type AdminUserOrder,
  type AdminUserReview,
  type AdminUserRole,
  type AdminUserRow,
} from "./types";

// Helpers service_role pour la surface admin /users (PR3, audit § 6 P2 #9).
// Centralise toutes les queries (liste + détail + 4 onglets) en mode
// READ-only — visualisation seule, donc aucune mutation ni audit log.
//
// Pourquoi service_role : public.users n'a aucune policy admin RLS — un
// admin connecté via createSupabaseServerClient() ne pourrait pas la lire.
// Lecture exclusive via service_role (bypass RLS). auth.users idem,
// PostgREST n'expose pas le schema auth aux clés anon/authenticated.
//
// Pattern aligné sur lib/admin/producers/fetch.ts (PR1) :
//   - Client Supabase injecté en paramètre (testabilité, pas de singleton).
//   - Mapping raw→AdminRow interne au helper (le caller ne connaît pas la
//     forme DB).
//   - Fail-safe : retourne { rows, error } plutôt que throw.

const PAGE_SIZE = 50;

export const ADMIN_USERS_PAGE_SIZE = PAGE_SIZE;

// ─── Liste ────────────────────────────────────────────────────────────────

export type FetchAdminUsersOptions = {
  cursor: ParsedCursor;
  // 'all' = pas de filtre rôle ; sinon filtre exact côté DB.
  roleFilter: "all" | AdminUserRole;
  // Recherche email — ILIKE %q% (case insensitive). null/undefined = pas
  // de filtre. Wildcards Postgres neutralisés côté helper.
  q: string | null;
};

export type FetchAdminUsersResult = {
  rows: AdminUserRow[];
  total: number;
  nextCursor: { created_at: string; id: string } | null;
  error: string | null;
};

type RawUserListRow = {
  id: string;
  email: string | null;
  prenom: string | null;
  nom: string | null;
  roles: string[] | null;
  created_at: string;
};

export async function fetchAdminUsersList(
  admin: SupabaseClient,
  opts: FetchAdminUsersOptions,
): Promise<FetchAdminUsersResult> {
  let itemsQuery = admin
    .from("users")
    .select("id, email, prenom, nom, roles, created_at");
  let countQuery = admin
    .from("users")
    .select("id", { count: "exact", head: true });

  if (opts.q && opts.q.trim().length > 0) {
    const term = `%${escapeIlikeEmail(opts.q.trim().toLowerCase())}%`;
    itemsQuery = itemsQuery.ilike("email", term);
    countQuery = countQuery.ilike("email", term);
  }

  // Le filtre rôle 'admin' n'est pas une valeur des roles[] DB : c'est dérivé
  // de la whitelist admin_users. Pour ce filtre on inverse le sens : on
  // récupère d'abord les `admin_users.id` (FK vers auth.users(id), row-as-PK
  // pattern — pas de colonne `user_id` séparée), puis on filtre `id IN (...)`.
  if (opts.roleFilter === "admin") {
    const { data: adminRows, error: adminErr } = await admin
      .from("admin_users")
      .select("id");
    if (adminErr) {
      return { rows: [], total: 0, nextCursor: null, error: adminErr.message };
    }
    const ids = (adminRows ?? [])
      .map((r) => (r as { id: string | null }).id)
      .filter((u): u is string => !!u);
    if (ids.length === 0) {
      return { rows: [], total: 0, nextCursor: null, error: null };
    }
    itemsQuery = itemsQuery.in("id", ids);
    countQuery = countQuery.in("id", ids);
  } else if (opts.roleFilter === "producer") {
    // roles[] contient 'producer' → contains array.
    itemsQuery = itemsQuery.contains("roles", ["producer"]);
    countQuery = countQuery.contains("roles", ["producer"]);
  } else if (opts.roleFilter === "consumer") {
    // Strict consumer = roles[] ne contient PAS 'producer'. Postgres array
    // negation via `not.cs` (contains). Le set 'consumer' implicite = tous
    // les users non-producer.
    itemsQuery = itemsQuery.not("roles", "cs", "{producer}");
    countQuery = countQuery.not("roles", "cs", "{producer}");
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

  const data = (itemsRes.data ?? []) as unknown as RawUserListRow[];
  const ids = data.map((u) => u.id);

  // Jointures secondaires : admin_users (whitelist) + auth.users
  // (last_sign_in_at) + counts orders. Tout en parallèle, bornés à la page.
  // admin_users.id est la PK (row-as-PK FK vers auth.users(id)) — pas de
  // colonne `user_id` séparée.
  const [adminIdsRes, authRes, ordersCountsRes] = await Promise.all([
    ids.length > 0
      ? admin.from("admin_users").select("id").in("id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length > 0
      ? admin
          .schema("auth")
          .from("users")
          .select("id, last_sign_in_at")
          .in("id", ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length > 0
      ? admin.from("orders").select("consumer_id").in("consumer_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Fail-safe sur les jointures secondaires : si erreur, on continue avec
  // des sets vides — la page liste reste utilisable, juste les colonnes
  // "dernière activité" et "commandes" tombent à null/0. Évite qu'une régression
  // RLS sur auth.users casse toute la liste.
  const adminSet = new Set(
    ((adminIdsRes.data ?? []) as Array<{ id: string | null }>)
      .map((r) => r.id)
      .filter((u): u is string => !!u),
  );
  const lastSignInById = new Map<string, string | null>();
  for (const r of (authRes.data ?? []) as Array<{
    id: string;
    last_sign_in_at: string | null;
  }>) {
    lastSignInById.set(r.id, r.last_sign_in_at);
  }
  const ordersCountById = new Map<string, number>();
  for (const r of (ordersCountsRes.data ?? []) as Array<{
    consumer_id: string | null;
  }>) {
    if (!r.consumer_id) continue;
    ordersCountById.set(
      r.consumer_id,
      (ordersCountById.get(r.consumer_id) ?? 0) + 1,
    );
  }

  const rows: AdminUserRow[] = data.map((u) => {
    const fullName =
      [u.prenom, u.nom].filter(Boolean).join(" ").trim() || "—";
    return {
      id: u.id,
      email: u.email ?? "—",
      fullName,
      role: deriveRole(u.roles, adminSet.has(u.id)),
      lastSignInAt: lastSignInById.get(u.id) ?? null,
      joinedAt: formatDateFr(u.created_at),
      ordersCount: ordersCountById.get(u.id) ?? 0,
    };
  });

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

// ─── Détail user ──────────────────────────────────────────────────────────

export type FetchAdminUserDetailResult = {
  user: AdminUserDetail | null;
  error: string | null;
};

export async function fetchAdminUserDetail(
  admin: SupabaseClient,
  userId: string,
): Promise<FetchAdminUserDetailResult> {
  const [pubRes, authRes, adminRowRes] = await Promise.all([
    admin
      .from("users")
      .select(
        "id, email, prenom, nom, telephone, sms_optin, roles, created_at",
      )
      .eq("id", userId)
      .maybeSingle(),
    admin
      .schema("auth")
      .from("users")
      .select("id, last_sign_in_at, email_confirmed_at, phone_confirmed_at")
      .eq("id", userId)
      .maybeSingle(),
    admin
      .from("admin_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (pubRes.error) {
    return { user: null, error: pubRes.error.message };
  }
  if (!pubRes.data) {
    return { user: null, error: null };
  }
  // auth.users miss : on continue sans last_sign_in_at, pas une erreur fatale
  // (tombstone, divergence mirror).
  const auth = (authRes.data ?? null) as {
    last_sign_in_at: string | null;
    email_confirmed_at: string | null;
    phone_confirmed_at: string | null;
  } | null;
  const pub = pubRes.data as {
    id: string;
    email: string | null;
    prenom: string | null;
    nom: string | null;
    telephone: string | null;
    sms_optin: boolean | null;
    roles: string[] | null;
    created_at: string;
  };
  const isAdmin = !!adminRowRes.data;

  return {
    user: {
      id: pub.id,
      email: pub.email ?? "—",
      prenom: pub.prenom,
      nom: pub.nom,
      telephone: pub.telephone,
      role: deriveRole(pub.roles, isAdmin),
      roles: pub.roles ?? [],
      smsOptin: pub.sms_optin,
      createdAt: pub.created_at,
      lastSignInAt: auth?.last_sign_in_at ?? null,
      emailConfirmedAt: auth?.email_confirmed_at ?? null,
      phoneConfirmedAt: auth?.phone_confirmed_at ?? null,
    },
    error: null,
  };
}

// ─── Onglet Commandes ─────────────────────────────────────────────────────

const ORDERS_LIMIT = 100;
const REVIEWS_LIMIT = 100;
const NOTIFICATIONS_LIMIT = 100;

export const ADMIN_USER_ORDERS_LIMIT = ORDERS_LIMIT;
export const ADMIN_USER_REVIEWS_LIMIT = REVIEWS_LIMIT;
export const ADMIN_USER_NOTIFICATIONS_LIMIT = NOTIFICATIONS_LIMIT;

export type FetchAdminUserOrdersResult = {
  orders: AdminUserOrder[];
  error: string | null;
};

export async function fetchAdminUserOrders(
  admin: SupabaseClient,
  userId: string,
): Promise<FetchAdminUserOrdersResult> {
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, code_commande, created_at, statut, montant_total, producer:producer_id ( nom_exploitation )",
    )
    .eq("consumer_id", userId)
    .order("created_at", { ascending: false })
    .limit(ORDERS_LIMIT);

  if (error) return { orders: [], error: error.message };

  const raw = (data ?? []) as unknown as Array<{
    id: string;
    code_commande: string | null;
    created_at: string;
    statut: string | null;
    montant_total: number | null;
    producer:
      | { nom_exploitation: string }
      | Array<{ nom_exploitation: string }>
      | null;
  }>;

  const orders: AdminUserOrder[] = raw.map((o) => {
    const producer = Array.isArray(o.producer) ? o.producer[0] : o.producer;
    return {
      id: o.id,
      codeCommande: o.code_commande,
      createdAt: o.created_at,
      statut: o.statut ?? "—",
      montantTotal:
        o.montant_total === null ? null : Number(o.montant_total),
      producerName: producer?.nom_exploitation ?? "—",
    };
  });

  return { orders, error: null };
}

// ─── Onglet Reviews ───────────────────────────────────────────────────────

export type FetchAdminUserReviewsResult = {
  reviews: AdminUserReview[];
  error: string | null;
};

function truncate(value: string | null | undefined, max = 200): string {
  if (!value) return "—";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export async function fetchAdminUserReviews(
  admin: SupabaseClient,
  userId: string,
): Promise<FetchAdminUserReviewsResult> {
  const { data, error } = await admin
    .from("reviews")
    .select(
      "id, created_at, note, statut, commentaire, producer:producer_id ( nom_exploitation )",
    )
    .eq("consumer_id", userId)
    .order("created_at", { ascending: false })
    .limit(REVIEWS_LIMIT);

  if (error) return { reviews: [], error: error.message };

  const raw = (data ?? []) as unknown as Array<{
    id: string;
    created_at: string;
    note: number | null;
    statut: string | null;
    commentaire: string | null;
    producer:
      | { nom_exploitation: string }
      | Array<{ nom_exploitation: string }>
      | null;
  }>;

  const reviews: AdminUserReview[] = raw.map((r) => {
    const producer = Array.isArray(r.producer) ? r.producer[0] : r.producer;
    return {
      id: r.id,
      createdAt: r.created_at,
      producerName: producer?.nom_exploitation ?? "—",
      note: r.note,
      statut: r.statut,
      commentaireExcerpt: truncate(r.commentaire),
    };
  });

  return { reviews, error: null };
}

// ─── Onglet Notifications ─────────────────────────────────────────────────

export type FetchAdminUserNotificationsResult = {
  notifications: AdminUserNotification[];
  error: string | null;
};

export async function fetchAdminUserNotifications(
  admin: SupabaseClient,
  userId: string,
): Promise<FetchAdminUserNotificationsResult> {
  const { data, error } = await admin
    .from("notifications")
    .select("id, created_at, type, statut, template, metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(NOTIFICATIONS_LIMIT);

  if (error) return { notifications: [], error: error.message };

  const raw = (data ?? []) as unknown as Array<{
    id: string;
    created_at: string;
    type: string | null;
    statut: string | null;
    template: string;
    metadata: Record<string, unknown> | null;
  }>;

  const notifications: AdminUserNotification[] = raw.map((n) => {
    // Best-effort : si metadata.subject existe (string), on l'expose.
    // Permet aux templates qui sérialisent leur sujet dans metadata
    // (cluster admin_*, opt-out) d'être lisibles depuis l'UI sans coupler
    // au moteur Resend.
    const meta = n.metadata ?? {};
    const subj =
      typeof (meta as { subject?: unknown }).subject === "string"
        ? ((meta as { subject?: string }).subject ?? null)
        : null;
    return {
      id: n.id,
      createdAt: n.created_at,
      channel: n.type,
      status: n.statut,
      template: n.template,
      subjectExcerpt: truncate(subj),
    };
  });

  return { notifications, error: null };
}

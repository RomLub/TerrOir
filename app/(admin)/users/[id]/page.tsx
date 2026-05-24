import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/ui/admin-page-header";
import { Badge } from "@/components/ui/badge";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  fetchAdminUserDetail,
  fetchAdminUserNotifications,
  fetchAdminUserOrders,
  fetchAdminUserReviews,
} from "@/lib/admin/users/fetch";
import type { AdminUserRole } from "@/lib/admin/users/types";
import { ListSkeleton } from "../../_components/ContentSkeletons";
import { UserDetailTabs } from "./_components/UserDetailTabs";

// Server Component admin /users/[id] (PR3). Fetch parallele 4 onglets via
// Promise.all + passage en props au Client Component pour le switch d'onglet
// visible. Pas de fetch dynamique cote client.

const ROLE_BADGE: Record<
  AdminUserRole,
  { label: string; variant: "green" | "terra" | "danger" | "gray" }
> = {
  consumer: { label: "Consumer", variant: "gray" },
  producer: { label: "Producteur", variant: "green" },
  admin: { label: "Admin", variant: "danger" },
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Coquille SYNCHRONE (streaming Suspense) : aucun accès dynamique en tête (params +
// validation UUID + fetch sont DANS le Gate). Le titre dépend de la donnée
// fetchée, donc tout le contenu est streamé via <Suspense>.
export default function AdminUserDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<ListSkeleton rows={6} />}>
      <UserDetailGate params={props.params} />
    </Suspense>
  );
}

async function UserDetailGate(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  // Garde syntaxique : si l'id n'est pas un UUID, 404 direct sans hitter
  // la DB (evite scan inutile + message d'erreur Postgres exotique).
  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const admin = createSupabaseAdminClient();

  // Charge le detail en premier : si user introuvable, on 404 sans payer
  // les 3 autres queries.
  const detailRes = await fetchAdminUserDetail(admin, id);
  if (detailRes.error) {
    return (
      <div>
        <AdminPageHeader
          eyebrow="Compte"
          title="Erreur"
          error={detailRes.error}
        />
        <Link
          href="/users"
          className="text-[13px] text-gray-600 underline-offset-2 hover:underline"
        >
          &larr; Retour a la liste
        </Link>
      </div>
    );
  }
  if (!detailRes.user) {
    notFound();
  }

  const user = detailRes.user;

  const [ordersRes, reviewsRes, notificationsRes] = await Promise.all([
    fetchAdminUserOrders(admin, id),
    fetchAdminUserReviews(admin, id),
    fetchAdminUserNotifications(admin, id),
  ]);

  const badge = ROLE_BADGE[user.role];

  return (
    <div>
      <AdminPageHeader
        eyebrow="Compte"
        title={user.email}
        subtitle={[user.prenom, user.nom].filter(Boolean).join(" ") || undefined}
        right={
          <div className="flex items-center gap-3">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <Link
              href="/users"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] text-gray-700 transition-colors hover:bg-gray-50"
            >
              &larr; Retour
            </Link>
          </div>
        }
      />

      <UserDetailTabs
        user={user}
        orders={ordersRes.orders}
        ordersError={ordersRes.error}
        reviews={reviewsRes.reviews}
        reviewsError={reviewsRes.error}
        notifications={notificationsRes.notifications}
        notificationsError={notificationsRes.error}
      />
    </div>
  );
}

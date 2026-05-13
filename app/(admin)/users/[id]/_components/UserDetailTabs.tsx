"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateFr } from "@/lib/format/date";
import { formatEuro } from "@/lib/format/currency";
import type {
  AdminUserDetail,
  AdminUserNotification,
  AdminUserOrder,
  AdminUserReview,
} from "@/lib/admin/users/types";

// Client Component minimal : gere uniquement le switch d'onglet visible.
// Les donnees des 4 onglets sont fetched cote Server Component parent
// (Promise.all) et passees en props. Pas de fetch dynamique cote client.

type TabKey = "profil" | "commandes" | "reviews" | "notifications";

export type UserDetailTabsProps = {
  user: AdminUserDetail;
  orders: AdminUserOrder[];
  ordersError: string | null;
  reviews: AdminUserReview[];
  reviewsError: string | null;
  notifications: AdminUserNotification[];
  notificationsError: string | null;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "profil", label: "Profil" },
  { key: "commandes", label: "Commandes" },
  { key: "reviews", label: "Reviews" },
  { key: "notifications", label: "Notifications" },
];

export function UserDetailTabs(props: UserDetailTabsProps) {
  const [active, setActive] = useState<TabKey>("profil");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Onglets utilisateur"
        className="mb-6 flex flex-wrap gap-2 border-b border-gray-200"
      >
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-tab={tab.key}
              data-active={isActive ? "true" : "false"}
              onClick={() => setActive(tab.key)}
              className={
                isActive
                  ? "border-b-2 border-terroir-green-700 px-4 py-2 text-[14px] font-medium text-terroir-green-700"
                  : "border-b-2 border-transparent px-4 py-2 text-[14px] text-gray-500 hover:text-gray-700"
              }
            >
              {tab.label}
              {tab.key === "commandes" && props.orders.length > 0 && (
                <span className="ml-1.5 text-[12px] text-gray-400">
                  ({props.orders.length})
                </span>
              )}
              {tab.key === "reviews" && props.reviews.length > 0 && (
                <span className="ml-1.5 text-[12px] text-gray-400">
                  ({props.reviews.length})
                </span>
              )}
              {tab.key === "notifications" &&
                props.notifications.length > 0 && (
                  <span className="ml-1.5 text-[12px] text-gray-400">
                    ({props.notifications.length})
                  </span>
                )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" data-panel={active}>
        {active === "profil" && <ProfilPanel user={props.user} />}
        {active === "commandes" && (
          <CommandesPanel
            orders={props.orders}
            error={props.ordersError}
          />
        )}
        {active === "reviews" && (
          <ReviewsPanel reviews={props.reviews} error={props.reviewsError} />
        )}
        {active === "notifications" && (
          <NotificationsPanel
            notifications={props.notifications}
            error={props.notificationsError}
          />
        )}
      </div>
    </div>
  );
}

// ─── Panels ───────────────────────────────────────────────────────────────

function ProfilPanel({ user }: { user: AdminUserDetail }) {
  const fullName =
    [user.prenom, user.nom].filter(Boolean).join(" ").trim() || "—";
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg border border-gray-200 bg-white p-5 text-[14px] sm:grid-cols-2">
      <Field label="Email" value={user.email} />
      <Field label="Nom complet" value={fullName} />
      <Field label="Telephone" value={user.telephone ?? "—"} />
      <Field
        label="Opt-in SMS"
        value={
          user.smsOptin === null ? "—" : user.smsOptin ? "Oui" : "Non"
        }
      />
      <Field
        label="Roles bruts"
        value={user.roles.length > 0 ? user.roles.join(", ") : "—"}
      />
      <Field label="Inscrit le" value={formatDateFr(user.createdAt)} />
      <Field
        label="Derniere connexion"
        value={
          user.lastSignInAt
            ? formatDateFr(user.lastSignInAt)
            : "Jamais connecte"
        }
      />
      <Field
        label="Email confirme"
        value={
          user.emailConfirmedAt
            ? formatDateFr(user.emailConfirmedAt)
            : "Non confirme"
        }
      />
      <Field
        label="Telephone confirme"
        value={
          user.phoneConfirmedAt
            ? formatDateFr(user.phoneConfirmedAt)
            : user.telephone
              ? "Non confirme"
              : "—"
        }
      />
    </dl>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-1 text-gray-900">{value}</dd>
    </div>
  );
}

function CommandesPanel({
  orders,
  error,
}: {
  orders: AdminUserOrder[];
  error: string | null;
}) {
  if (error) return <ErrorBox message={error} />;
  if (orders.length === 0) return <EmptyBox message="Aucune commande" />;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-[13px]">
        <thead className="bg-gray-50">
          <tr>
            <Th>Code</Th>
            <Th>Date</Th>
            <Th>Producteur</Th>
            <Th>Statut</Th>
            <Th align="right">Montant</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-gray-50">
              <td className="px-5 py-3 font-mono text-[12px] text-gray-700">
                {o.codeCommande ?? o.id.slice(0, 8)}
              </td>
              <td className="px-5 py-3 text-gray-500">
                {formatDateFr(o.createdAt)}
              </td>
              <td className="px-5 py-3 text-gray-900">{o.producerName}</td>
              <td className="px-5 py-3">
                <Badge variant={statutBadgeVariant(o.statut)}>
                  {o.statut}
                </Badge>
              </td>
              <td className="px-5 py-3 text-right text-gray-700">
                {formatEuro(o.montantTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewsPanel({
  reviews,
  error,
}: {
  reviews: AdminUserReview[];
  error: string | null;
}) {
  if (error) return <ErrorBox message={error} />;
  if (reviews.length === 0) return <EmptyBox message="Aucun avis" />;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-[13px]">
        <thead className="bg-gray-50">
          <tr>
            <Th>Date</Th>
            <Th>Producteur</Th>
            <Th align="center">Note</Th>
            <Th>Statut</Th>
            <Th>Commentaire</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {reviews.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-5 py-3 text-gray-500">
                {formatDateFr(r.createdAt)}
              </td>
              <td className="px-5 py-3 text-gray-900">{r.producerName}</td>
              <td className="px-5 py-3 text-center text-gray-700">
                {r.note ?? "—"}/5
              </td>
              <td className="px-5 py-3 text-gray-700">{r.statut ?? "—"}</td>
              <td className="px-5 py-3 text-gray-700">
                {r.commentaireExcerpt}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotificationsPanel({
  notifications,
  error,
}: {
  notifications: AdminUserNotification[];
  error: string | null;
}) {
  if (error) return <ErrorBox message={error} />;
  if (notifications.length === 0)
    return <EmptyBox message="Aucune notification" />;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-[13px]">
        <thead className="bg-gray-50">
          <tr>
            <Th>Date</Th>
            <Th>Canal</Th>
            <Th>Template</Th>
            <Th>Statut</Th>
            <Th>Sujet</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {notifications.map((n) => (
            <tr key={n.id} className="hover:bg-gray-50">
              <td className="px-5 py-3 text-gray-500">
                {formatDateFr(n.createdAt)}
              </td>
              <td className="px-5 py-3 text-gray-700">{n.channel ?? "—"}</td>
              <td className="px-5 py-3 font-mono text-[12px] text-gray-700">
                {n.template}
              </td>
              <td className="px-5 py-3">
                <Badge variant={notificationStatusVariant(n.status)}>
                  {n.status ?? "—"}
                </Badge>
              </td>
              <td className="px-5 py-3 text-gray-700">{n.subjectExcerpt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Small utils ──────────────────────────────────────────────────────────

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const cls =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";
  return (
    <th className={`px-5 py-3 ${cls} font-medium text-gray-600`}>
      {children}
    </th>
  );
}

function EmptyBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-[14px] text-gray-500">
      {message}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-[13px] text-red-700">
      {message}
    </div>
  );
}

function statutBadgeVariant(
  statut: string,
): "green" | "terra" | "gray" | "danger" | "blue" {
  switch (statut) {
    case "completed":
      return "green";
    case "confirmed":
    case "pending":
      return "terra";
    case "cancelled":
    case "refunded":
      return "danger";
    default:
      return "gray";
  }
}

function notificationStatusVariant(
  status: string | null,
): "green" | "danger" | "gray" {
  if (status === "sent") return "green";
  if (status === "failed") return "danger";
  return "gray";
}

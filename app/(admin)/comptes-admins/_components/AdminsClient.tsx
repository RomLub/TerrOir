"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AdminPageHeader,
  Badge,
  Button,
  TableActionButton,
  TableStatus,
} from "@/components/ui";
import type { AdminAccountRow } from "@/lib/admin/admins/fetch";

// Chantier 6 — UI client de la page Administrateurs. Lecture pour tout admin ;
// actions (promote/suspend/reactivate/privilege/revoke) réservées au
// super_admin. Sur sa PROPRE ligne, les boutons sont désactivés + tooltip
// (défense en profondeur visuelle, en plus des gardes route + RPC).

const SELF_TOOLTIP = "Vous ne pouvez pas vous appliquer cette action à vous-même.";

type Props = {
  admins: AdminAccountRow[];
  initialError: string | null;
  currentAdminId: string;
  isSuperAdmin: boolean;
};

export function AdminsClient({
  admins,
  initialError,
  currentAdminId,
  isSuperAdmin,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState<string | null>(null);
  const [promoteEmail, setPromoteEmail] = useState("");
  const [promotePrivilege, setPromotePrivilege] = useState<"standard" | "super_admin">(
    "standard",
  );
  const [, startTransition] = useTransition();

  async function callOp(busyKey: string, url: string, body?: unknown) {
    setBusy(busyKey);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Erreur HTTP ${res.status}`);
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onPromote() {
    const email = promoteEmail.trim();
    if (!email) {
      setError("Email requis.");
      return;
    }
    const ok = await callOp("promote", "/api/admin/admins/promote", {
      email,
      privilege: promotePrivilege,
    });
    if (ok) setPromoteEmail("");
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="Gouvernance"
        title="Administrateurs"
        subtitle={`${admins.length} compte${admins.length > 1 ? "s" : ""} administrateur${admins.length > 1 ? "s" : ""}`}
        error={error}
      />

      {isSuperAdmin ? (
        <div className="mb-6 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-serif text-[17px] text-gray-900">
            Promouvoir un compte client
          </h2>
          <p className="mb-3 text-[13px] text-gray-600">
            Le compte doit déjà exister (inscrit comme client). Il deviendra
            administrateur et perdra sa fiche client.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={promoteEmail}
              onChange={(e) => setPromoteEmail(e.target.value)}
              placeholder="email@exemple.fr"
              className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none"
            />
            <select
              value={promotePrivilege}
              onChange={(e) =>
                setPromotePrivilege(e.target.value as "standard" | "super_admin")
              }
              className="rounded-md border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none"
            >
              <option value="standard">Admin standard</option>
              <option value="super_admin">Super-admin</option>
            </select>
            <Button onClick={onPromote} disabled={busy === "promote"}>
              Promouvoir
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Nom</th>
                <th className="px-5 py-3 font-semibold">Niveau</th>
                <th className="px-5 py-3 font-semibold">Statut</th>
                <th className="px-5 py-3 font-semibold">Inscrit le</th>
                {isSuperAdmin ? (
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {admins.length === 0 ? (
                <TableStatus
                  kind="empty"
                  colSpan={isSuperAdmin ? 6 : 5}
                  emptyLabel="Aucun administrateur."
                />
              ) : (
                admins.map((a) => {
                  const isSelf = a.id === currentAdminId;
                  const disabled = busy === a.id;
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-gray-200 last:border-0 hover:bg-gray-50"
                    >
                      <td className="px-5 py-4 text-gray-900">
                        {a.email ?? "—"}
                        {isSelf ? (
                          <span className="ml-2 text-[11px] text-gray-400">(vous)</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-gray-700">{a.fullName}</td>
                      <td className="px-5 py-4">
                        <Badge variant={a.privilege === "super_admin" ? "danger" : "gray"}>
                          {a.privilege === "super_admin" ? "Super-admin" : "Standard"}
                        </Badge>
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant={a.suspended ? "terra" : "green"}>
                          {a.suspended ? "Suspendu" : "Actif"}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 font-mono text-[13px] text-gray-500">
                        {a.createdAt}
                      </td>
                      {isSuperAdmin ? (
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {a.suspended ? (
                              <TableActionButton
                                variant="ghost"
                                disabled={disabled}
                                onClick={() =>
                                  callOp(a.id, `/api/admin/admins/${a.id}/reactivate`)
                                }
                              >
                                Réactiver
                              </TableActionButton>
                            ) : (
                              <TableActionButton
                                variant="ghost-danger"
                                disabled={disabled || isSelf}
                                title={isSelf ? SELF_TOOLTIP : undefined}
                                onClick={() =>
                                  callOp(a.id, `/api/admin/admins/${a.id}/suspend`)
                                }
                              >
                                Suspendre
                              </TableActionButton>
                            )}
                            <TableActionButton
                              variant="ghost"
                              disabled={disabled || isSelf}
                              title={isSelf ? SELF_TOOLTIP : undefined}
                              onClick={() =>
                                callOp(a.id, `/api/admin/admins/${a.id}/privilege`, {
                                  privilege:
                                    a.privilege === "super_admin"
                                      ? "standard"
                                      : "super_admin",
                                })
                              }
                            >
                              {a.privilege === "super_admin"
                                ? "Rétrograder"
                                : "Promouvoir super-admin"}
                            </TableActionButton>
                            <TableActionButton
                              variant="ghost-danger"
                              disabled={disabled || isSelf}
                              title={isSelf ? SELF_TOOLTIP : undefined}
                              onClick={() =>
                                callOp(a.id, `/api/admin/admins/${a.id}/revoke`)
                              }
                            >
                              Retirer
                            </TableActionButton>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

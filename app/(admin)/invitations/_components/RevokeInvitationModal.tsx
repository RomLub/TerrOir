"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminModal } from "@/components/ui";

// Modal de confirmation de révocation d'une invitation producteur.
// Pattern aligné `ConfirmValidateModal` (gestion-producteurs) :
// AdminModal + boutons Annuler / Confirmer + state local pour busy/error.
//
// Côté API : POST /api/admin/invitations/[id]/revoke retourne :
//   - 200 nominal : { id, revoked_at }
//   - 200 noop    : { id, revoked_at, noop: true } (déjà révoquée)
//   - 409         : { error: "Invitation déjà consommée, ..." }
//   - 4xx/5xx     : { error?: string }
//
// Sur succès (200), on close le modal et router.refresh() pour que le
// Server Component re-fetch la liste (la row passera de "sent" à
// "revoked", avec disparition du bouton "Révoquer").

type Props = {
  invitationId: string;
  invitationEmail: string;
  onClose: () => void;
};

export function RevokeInvitationModal({
  invitationId,
  invitationEmail,
  onClose,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/invitations/${invitationId}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(
          body?.error ?? "Invitation déjà consommée, impossible de révoquer",
        );
        setBusy(false);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `Erreur HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      // Succès (200 nominal OU 200 noop) : on ferme + refresh.
      router.refresh();
      onClose();
    } catch {
      setError("Erreur de connexion");
      setBusy(false);
    }
  };

  return (
    <AdminModal
      open
      onClose={busy ? () => {} : onClose}
      eyebrow="Révocation"
      title="Révoquer cette invitation ?"
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-red-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Révocation…" : "Confirmer la révocation"}
          </button>
        </>
      }
    >
      <p className="mt-3 text-[14px] leading-relaxed text-gray-700">
        Cette action est irréversible. Le lien d&apos;invitation envoyé à{" "}
        <span className="font-semibold text-gray-900">{invitationEmail}</span>{" "}
        ne pourra plus être utilisé.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-900"
        >
          {error}
        </p>
      )}
    </AdminModal>
  );
}

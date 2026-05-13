"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminModal, Button } from "@/components/ui";

// Modal de résolution manuelle d'un incident refund (PR3 feature/admin-
// new-surfaces — gap AUDIT_ADMIN.md §6 P0 #3). Client Component séparé
// pour gérer l'état du textarea + l'appel POST + le router.refresh()
// (cohérent pattern PR1 GestionProducteursClient).
//
// Le composant est rendu UNIQUEMENT côté Server Component détail si le
// statut est actionnable (cf. isRefundIncidentActionable). Le double
// rideau côté serveur (Server Component qui masque le bouton + API
// route qui retourne 409) protège contre une race où l'incident passe à
// `succeeded` entre l'affichage et le clic.

const MIN_NOTE_LENGTH = 5;

type Props = {
  incidentId: string;
};

export function ResolveIncidentModalLauncher({ incidentId }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
        Marquer comme résolu manuellement
      </Button>
      <ResolveIncidentModal
        open={open}
        incidentId={incidentId}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

type ModalProps = {
  open: boolean;
  incidentId: string;
  onClose: () => void;
};

export function ResolveIncidentModal({ open, incidentId, onClose }: ModalProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  const trimmedLength = note.trim().length;
  const isNoteValid = trimmedLength >= MIN_NOTE_LENGTH;

  const handleSubmit = async () => {
    if (!isNoteValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/refund-incidents/${incidentId}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: note.trim() }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (res.status === 409) {
          setError(
            body?.error ?? "Incident non actionnable (déjà résolu ou annulé).",
          );
        } else {
          setError(body?.error ?? `Erreur HTTP ${res.status}`);
        }
        setSubmitting(false);
        return;
      }
      // Succès : ferme + refresh Server Component (refetch détail avec
      // nouveau statut manually_resolved + masquage du bouton action).
      startTransition(() => {
        router.refresh();
        setSubmitting(false);
        setNote("");
        onClose();
      });
    } catch (err) {
      setError((err as Error).message || "Erreur réseau");
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setNote("");
    setError(null);
    onClose();
  };

  return (
    <AdminModal
      open={open}
      onClose={handleClose}
      eyebrow="Résolution manuelle"
      title="Marquer l'incident comme résolu"
      footer={
        <>
          <Button
            variant="ghost"
            size="md"
            onClick={handleClose}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!isNoteValid || submitting}
          >
            {submitting ? "Confirmation..." : "Confirmer"}
          </Button>
        </>
      }
    >
      <div className="mt-4 space-y-3">
        <p className="text-sm text-gray-700">
          Cette action marque l&rsquo;incident comme résolu manuellement et
          empêche tout nouveau retry automatique. La note ci-dessous est
          obligatoire et tracée dans l&rsquo;audit log forensique.
        </p>
        <label
          htmlFor="resolve-note"
          className="block text-sm font-medium text-gray-700"
        >
          Note de résolution (min. {MIN_NOTE_LENGTH} caractères)
        </label>
        <textarea
          id="resolve-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={2000}
          disabled={submitting}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-terroir-green-700 focus:outline-none focus:ring-1 focus:ring-terroir-green-700"
          placeholder="Expliquez pourquoi cet incident est résolu manuellement (ex : virement bancaire effectué hors-Stripe, avoir consommé, contact consumer le ...)."
        />
        <p className="text-xs text-gray-500">
          {trimmedLength} / 2000 caractères
          {!isNoteValid && trimmedLength > 0
            ? ` (encore ${MIN_NOTE_LENGTH - trimmedLength} caractères requis)`
            : ""}
        </p>
        {error ? (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </AdminModal>
  );
}

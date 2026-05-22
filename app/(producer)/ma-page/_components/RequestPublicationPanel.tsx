"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

// Chantier 3 Phase 4 — panneau « Demander la publication » côté producteur.
// POST /api/producer/request-publication ; en cas de critères manquants (422),
// la route renvoie la liste qu'on mappe en libellés FR.

const CRITERIA_LABELS: Record<string, string> = {
  description: "Une description d'au moins 150 caractères",
  photo_principale: "Une photo de couverture",
  localisation: "Commune et code postal renseignés",
  stripe: "Paiements activés (compte de paiement vérifié)",
  product_with_photo: "Au moins un produit publié avec une photo",
  open_slot: "Au moins un créneau de retrait ouvert",
};

export function RequestPublicationPanel({
  statut,
  publicationRequestedAt,
}: {
  statut: string | null;
  publicationRequestedAt: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [requested, setRequested] = useState(Boolean(publicationRequestedAt));
  const [error, setError] = useState<string | null>(null);

  if (statut === "public") {
    return (
      <section className="rounded-2xl border border-green-300 bg-green-50 p-5 text-sm text-green-800">
        ✓ Votre fiche est en ligne et visible des consommateurs.
      </section>
    );
  }

  if (requested) {
    return (
      <section className="rounded-2xl border border-terra-200 bg-terra-50 p-5 text-sm text-terra-800">
        Votre demande de publication est en cours de validation par l&rsquo;équipe
        TerrOir. Vous recevrez un email dès qu&rsquo;elle sera acceptée.
      </section>
    );
  }

  async function request() {
    setBusy(true);
    setError(null);
    setMissing(null);
    try {
      const res = await fetch("/api/producer/request-publication", {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        missing?: string[];
        blocked?: string | null;
      } | null;
      if (res.ok) {
        setRequested(true);
        return;
      }
      if (res.status === 422 && data) {
        if (data.blocked) {
          setError("Votre fiche ne peut pas être publiée dans son état actuel.");
        } else {
          setMissing(data.missing ?? []);
        }
        return;
      }
      setError("Demande impossible pour le moment. Réessayez plus tard.");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-dark/[0.08] bg-white p-5">
      <h2 className="font-serif text-[20px] text-green-900">Mettre ma fiche en ligne</h2>
      <p className="mt-1 text-sm text-dark/65">
        Quand votre fiche est prête, demandez sa publication. Notre équipe la
        valide avant sa mise en ligne.
      </p>

      {missing && missing.length > 0 ? (
        <div className="mt-3 rounded-lg bg-terra-50 border border-terra-200 px-4 py-3 text-sm text-terra-800">
          <p className="font-semibold">Il manque encore :</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {missing.map((m) => (
              <li key={m}>{CRITERIA_LABELS[m] ?? m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-terra-700">{error}</p> : null}

      <div className="mt-4">
        <Button variant="accent" onClick={request} disabled={busy}>
          {busy ? "Envoi…" : "Demander la publication"}
        </Button>
      </div>
    </section>
  );
}

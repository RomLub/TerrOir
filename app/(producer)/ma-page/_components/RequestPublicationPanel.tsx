"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";

// Panneau « Mettre ma fiche en ligne » (ADR-0011). Affiche une CHECKLIST des 6
// critères (✓/✗) récupérée via GET /api/producer/publication-status, avec des
// liens « Compléter » vers la bonne page, puis le bouton de demande (actif
// seulement quand tout est prêt). La validation finale reste côté serveur
// (POST /api/producer/request-publication).

type Criteria = {
  description: boolean;
  photo_principale: boolean;
  localisation: boolean;
  stripe: boolean;
  product_with_photo: boolean;
  open_slot: boolean;
};

const CRITERIA: { key: keyof Criteria; label: string; href?: string }[] = [
  { key: "description", label: "Une description d'au moins 150 caractères" },
  { key: "photo_principale", label: "Une photo de couverture" },
  { key: "localisation", label: "Commune et code postal renseignés" },
  {
    key: "product_with_photo",
    label: "Au moins un produit publié avec une photo",
    href: "/catalogue",
  },
  {
    key: "open_slot",
    label: "Au moins un créneau de retrait ouvert",
    href: "/creneaux",
  },
  { key: "stripe", label: "Paiements activés (compte vérifié)", href: "/parametres" },
];

export function RequestPublicationPanel({
  statut,
  publicationRequestedAt,
}: {
  statut: string | null;
  publicationRequestedAt: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(Boolean(publicationRequestedAt));
  const [error, setError] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [allOk, setAllOk] = useState(false);

  const hidden = statut === "public" || requested;

  useEffect(() => {
    if (hidden) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/producer/publication-status");
        const data = (await res.json().catch(() => null)) as
          | { criteria?: Criteria; allOk?: boolean }
          | null;
        if (!active || !data) return;
        if (data.criteria) setCriteria(data.criteria);
        setAllOk(Boolean(data.allOk));
      } catch {
        // Best-effort : la checklist ne bloque pas l'affichage de la page.
      }
    })();
    return () => {
      active = false;
    };
  }, [hidden]);

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
    try {
      const res = await fetch("/api/producer/request-publication", {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        blocked?: string | null;
      } | null;
      if (res.ok) {
        setRequested(true);
        return;
      }
      if (res.status === 422 && data?.blocked) {
        setError("Votre fiche ne peut pas être publiée dans son état actuel.");
        return;
      }
      setError("Demande impossible pour le moment. Réessayez plus tard.");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  const doneCount = criteria
    ? CRITERIA.filter((c) => criteria[c.key]).length
    : 0;

  return (
    <section className="rounded-2xl border border-dark/[0.08] bg-white p-5">
      <h2 className="font-serif text-[20px] text-green-900">
        Mettre ma fiche en ligne
      </h2>
      <p className="mt-1 text-sm text-dark/65">
        Complétez ces étapes, puis demandez la publication. Notre équipe la valide
        avant la mise en ligne.
      </p>

      {criteria ? (
        <div className="mt-4">
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-dark/55">
            {doneCount}/6 étapes
          </div>
          <ul className="space-y-1.5">
            {CRITERIA.map((c) => {
              const ok = criteria[c.key];
              return (
                <li key={c.key} className="flex items-center gap-2 text-sm">
                  <span className={ok ? "text-green-700" : "text-dark/30"}>
                    {ok ? "✓" : "○"}
                  </span>
                  <span className={ok ? "text-dark/55" : "text-dark/80"}>
                    {c.label}
                  </span>
                  {!ok && c.href ? (
                    <Link
                      href={c.href}
                      className="text-[12px] text-terra-700 underline hover:text-terra-700/70"
                    >
                      Compléter
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-terra-700">{error}</p> : null}

      <div className="mt-4">
        <Button variant="accent" onClick={request} disabled={busy || !allOk}>
          {busy ? "Envoi…" : "Demander la publication"}
        </Button>
        {criteria && !allOk ? (
          <p className="mt-2 text-[12px] text-dark/50">
            Terminez les étapes ci-dessus pour pouvoir demander la publication.
          </p>
        ) : null}
      </div>
    </section>
  );
}

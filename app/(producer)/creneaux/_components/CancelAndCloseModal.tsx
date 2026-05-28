"use client";

import { useState } from "react";
import type { BlockingOrder } from "../actions";

// Modale "Annuler et fermer" : déclenchée quand le producteur tente
// d'exclure un slot ayant des commandes actives (cf. chantier
// 2026-05-29). Le bloc d'audit/plan vit dans `app/(producer)/creneaux/
// actions.ts` (helper fetchBlockingOrders qui retourne la shape
// BlockingOrder).
//
// Flow :
//   1. Affichage de la liste détaillée des commandes bloquantes
//      (client, code, montant, créneau de retrait).
//   2. Mention explicite des 3 conséquences (remboursement Stripe,
//      email Resend, impact score de fiabilité).
//   3. Si confirmation : boucle SÉQUENTIELLE d'appels
//      POST /api/orders/:id/cancel?reason=producer_cancel (chaque
//      cancel déclenche refund + email + recompute badge côté serveur).
//   4. Si TOUTES les annulations passent : appel onAllCancelled qui
//      retentera l'exclusion côté parent.
//   5. Si ÉCHEC PARTIEL : la modale reste ouverte, état dédié avec
//      ✓/✗ par commande + bouton "Réessayer les annulations échouées".
//      Le créneau N'EST PAS fermé.

const ENDPOINT_FOR = (id: string) => `/api/orders/${id}/cancel`;

type CancelResult = {
  order: BlockingOrder;
  ok: boolean;
  error?: string;
};

type Phase =
  | { kind: "idle" }
  | { kind: "running"; current: number; total: number }
  | { kind: "results"; results: CancelResult[] };

function formatRetrait(starts_at: string | null, ends_at: string | null): string {
  if (!starts_at || !ends_at) return "Créneau —";
  const start = new Date(starts_at);
  const end = new Date(ends_at);
  const dateLabel = start.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("fr-FR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
  return `${dateLabel}, ${fmtTime(start)}–${fmtTime(end)}`;
}

function formatMontant(montant: number): string {
  return `${montant.toFixed(2).replace(".", ",")} €`;
}

async function cancelOne(order: BlockingOrder): Promise<CancelResult> {
  try {
    const res = await fetch(ENDPOINT_FOR(order.id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "producer_cancel" }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        order,
        ok: false,
        error: body.error ?? `HTTP ${res.status}`,
      };
    }
    return { order, ok: true };
  } catch (e) {
    return { order, ok: false, error: (e as Error).message };
  }
}

export type CancelAndCloseModalProps = {
  blockingOrders: BlockingOrder[];
  /** Appelé quand l'utilisateur ferme la modale sans annuler (ou ferme
   *  après résultats). Le parent doit décider quoi faire. */
  onClose: () => void;
  /** Appelé quand toutes les annulations ont réussi. Le parent retente
   *  alors l'action d'exclusion. */
  onAllCancelled: () => void;
};

export function CancelAndCloseModal({
  blockingOrders,
  onClose,
  onAllCancelled,
}: CancelAndCloseModalProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Boucle séquentielle. Filtre des commandes à retenter quand on est
  // en phase "results" avec échecs partiels.
  async function runCancellations(toCancel: BlockingOrder[]) {
    const results: CancelResult[] = [];
    for (let i = 0; i < toCancel.length; i++) {
      setPhase({ kind: "running", current: i + 1, total: toCancel.length });
      const r = await cancelOne(toCancel[i]!);
      results.push(r);
    }
    // Fusionne les résultats existants (si retry partiel) avec les nouveaux.
    if (phase.kind === "results") {
      const previousOk = phase.results.filter((r) => r.ok);
      const merged = [...previousOk, ...results];
      setPhase({ kind: "results", results: merged });
      if (merged.every((r) => r.ok)) {
        onAllCancelled();
      }
    } else {
      setPhase({ kind: "results", results });
      if (results.every((r) => r.ok)) {
        onAllCancelled();
      }
    }
  }

  function onConfirm() {
    void runCancellations(blockingOrders);
  }

  function onRetryFailed() {
    if (phase.kind !== "results") return;
    const failed = phase.results.filter((r) => !r.ok).map((r) => r.order);
    if (failed.length === 0) return;
    void runCancellations(failed);
  }

  const orderCount = blockingOrders.length;
  const noun = orderCount > 1 ? "commandes" : "commande";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={phase.kind === "running" ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-close-modal-title"
      data-testid="cancel-and-close-modal"
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-8 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="cancel-close-modal-title"
          className="font-serif text-[28px] leading-tight text-green-900"
        >
          Annuler les commandes pour fermer ce créneau
        </h2>

        <p className="mt-4 text-[14px] text-dark/70">
          Ce créneau a {orderCount} {noun} en attente. Pour le fermer, vous
          devez d&apos;abord annuler {orderCount > 1 ? "ces" : "cette"} {noun}.
        </p>

        {/* Liste des commandes bloquantes */}
        <ul className="mt-5 space-y-2" data-testid="blocking-orders-list">
          {blockingOrders.map((o) => {
            const result =
              phase.kind === "results"
                ? phase.results.find((r) => r.order.id === o.id)
                : null;
            const status = result ? (result.ok ? "ok" : "fail") : null;
            return (
              <li
                key={o.id}
                data-testid="blocking-order-row"
                data-order-id={o.id}
                data-status={status ?? ""}
                className={`rounded-xl border p-3 text-[13px] ${
                  status === "ok"
                    ? "border-green-700/40 bg-green-100/40"
                    : status === "fail"
                      ? "border-terra-700/40 bg-terra-100/40"
                      : "border-dark/10 bg-bg"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-green-900">
                    {status === "ok" && <span aria-hidden="true">✓ </span>}
                    {status === "fail" && <span aria-hidden="true">✗ </span>}
                    {o.consumer_prenom ?? "Client"}
                    {` · ${o.numero_commande}`}
                  </div>
                  <div className="tabular-nums text-dark/70">
                    {formatMontant(o.montant_total)}
                  </div>
                </div>
                <div className="mt-1 text-[12px] text-dark/55">
                  Retrait : {formatRetrait(o.slot_starts_at, o.slot_ends_at)}
                </div>
                {status === "fail" && result?.error && (
                  <div className="mt-1 text-[12px] text-terra-700">
                    {result.error}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Bloc Conséquences : visible uniquement en phase idle (avant
            confirmation). Une fois lancé, on cache pour mettre en avant
            la progression / les résultats. */}
        {phase.kind === "idle" && (
          <div className="mt-5 rounded-xl border border-terra-700/20 bg-terra-100/30 p-4 text-[13px] text-dark/75">
            <div className="font-medium text-green-900">
              Conséquences si vous continuez :
            </div>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>
                Les clients seront remboursés intégralement (Stripe).
              </li>
              <li>
                Ils recevront un email d&apos;annulation automatique.
              </li>
              <li>
                Cette annulation sera prise en compte dans votre score de
                fiabilité, visible par vos clients.
              </li>
            </ul>
          </div>
        )}

        {/* Footer CTAs */}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {phase.kind === "idle" && (
            <>
              <button
                type="button"
                onClick={onClose}
                data-testid="cancel-modal-keep-open"
                className="h-11 rounded-xl border border-dark/15 px-4 text-[14px] font-medium text-dark/75 hover:bg-dark/[0.04]"
              >
                Garder le créneau ouvert
              </button>
              <button
                type="button"
                onClick={onConfirm}
                data-testid="cancel-modal-confirm"
                className="h-11 rounded-xl bg-terra-700 px-5 text-[14px] font-semibold text-white hover:bg-terra-700/90"
              >
                Annuler {orderCount > 1 ? "ces commandes" : "cette commande"} et fermer
              </button>
            </>
          )}

          {phase.kind === "running" && (
            <button
              type="button"
              disabled
              data-testid="cancel-modal-running"
              className="h-11 rounded-xl bg-terra-700/60 px-5 text-[14px] font-semibold text-white cursor-wait"
            >
              Annulation en cours… ({phase.current}/{phase.total})
            </button>
          )}

          {phase.kind === "results" && (
            <>
              <button
                type="button"
                onClick={onClose}
                data-testid="cancel-modal-close-after-results"
                className="h-11 rounded-xl border border-dark/15 px-4 text-[14px] font-medium text-dark/75 hover:bg-dark/[0.04]"
              >
                Fermer
              </button>
              {phase.results.some((r) => !r.ok) && (
                <button
                  type="button"
                  onClick={onRetryFailed}
                  data-testid="cancel-modal-retry-failed"
                  className="h-11 rounded-xl bg-terra-700 px-5 text-[14px] font-semibold text-white hover:bg-terra-700/90"
                >
                  Réessayer les annulations échouées
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

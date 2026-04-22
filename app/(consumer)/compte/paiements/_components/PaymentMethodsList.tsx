"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import AddCardModal from "./AddCardModal";
import {
  detachPaymentMethodAction,
  setDefaultPaymentMethodAction,
} from "../actions";

export interface PaymentMethodSummary {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

function formatBrand(brand: string): string {
  const map: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    discover: "Discover",
    diners: "Diners",
    jcb: "JCB",
    unionpay: "UnionPay",
    unknown: "Carte",
  };
  return map[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

function formatExpiration(month: number, year: number): string {
  const mm = String(month).padStart(2, "0");
  const yy = String(year).slice(-2);
  return `${mm}/${yy}`;
}

const STATUS_TTL_MS = 3000;

export default function PaymentMethodsList({
  initialMethods,
}: {
  initialMethods: PaymentMethodSummary[];
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmingDetach, setConfirmingDetach] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const flash = (msg: string) => {
    setStatusMessage(msg);
    setErrorMessage(null);
    setTimeout(() => setStatusMessage(null), STATUS_TTL_MS);
  };

  const flashError = (msg: string) => {
    setErrorMessage(msg);
    setStatusMessage(null);
    setTimeout(() => setErrorMessage(null), STATUS_TTL_MS);
  };

  const handleSetDefault = (pm: PaymentMethodSummary) => {
    startTransition(async () => {
      const res = await setDefaultPaymentMethodAction(pm.id);
      if ("error" in res) {
        flashError(res.error);
        return;
      }
      flash(
        `Carte ${formatBrand(pm.brand)} •••• ${pm.last4} définie par défaut.`,
      );
      router.refresh();
    });
  };

  const handleDetach = (pm: PaymentMethodSummary) => {
    const deletedLabel = `${formatBrand(pm.brand)} •••• ${pm.last4}`;
    startTransition(async () => {
      const res = await detachPaymentMethodAction(pm.id);
      setConfirmingDetach(null);
      if ("error" in res) {
        flashError(res.error);
        return;
      }
      if (res.defaultChanged && res.newDefault) {
        const newDefaultLabel = `${formatBrand(res.newDefault.brand)} •••• ${res.newDefault.last4}`;
        flash(
          `Carte ${deletedLabel} supprimée. ${newDefaultLabel} est maintenant votre carte par défaut.`,
        );
      } else {
        flash(`Carte ${deletedLabel} supprimée.`);
      }
      router.refresh();
    });
  };

  const onAddSuccess = () => {
    setModalOpen(false);
    flash("Carte ajoutée.");
    router.refresh();
  };

  return (
    <section>
      {initialMethods.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-terroir-border bg-white/40 p-8 text-center">
          <p className="text-sm text-terroir-muted">
            Aucune carte enregistrée pour le moment.
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-md bg-terroir-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-terroir-green-700/90"
            >
              Ajouter une carte
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {initialMethods.map((pm) => {
              const confirming = confirmingDetach === pm.id;
              return (
                <li
                  key={pm.id}
                  className="rounded-2xl border border-terroir-border bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-terroir-ink">
                          {formatBrand(pm.brand)}
                        </span>
                        <span className="font-mono text-sm text-terroir-muted">
                          •••• {pm.last4}
                        </span>
                        {pm.isDefault ? (
                          <span className="rounded-full bg-terroir-green-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-terroir-green-700">
                            Par défaut
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-terroir-muted">
                        Expire le {formatExpiration(pm.expMonth, pm.expYear)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {confirming ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setConfirmingDetach(null)}
                            className="text-[13px] text-gray-600 hover:text-gray-900"
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDetach(pm)}
                            className="rounded-md bg-red-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-red-700"
                          >
                            Confirmer
                          </button>
                        </>
                      ) : (
                        <>
                          {!pm.isDefault ? (
                            <button
                              type="button"
                              onClick={() => handleSetDefault(pm)}
                              className="text-[13px] text-terroir-green-700 hover:underline"
                            >
                              Définir par défaut
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setConfirmingDetach(pm.id)}
                            className="text-[13px] text-red-600 hover:underline"
                          >
                            Supprimer
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-md border border-terroir-border bg-white px-4 py-2 text-sm font-medium text-terroir-ink transition-colors hover:bg-terroir-bg"
            >
              Ajouter une carte
            </button>
          </div>
        </>
      )}

      {statusMessage ? (
        <p className="mt-4 text-sm text-terroir-green-700" role="status">
          {statusMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {modalOpen ? (
        <AddCardModal
          onClose={() => setModalOpen(false)}
          onSuccess={onAddSuccess}
        />
      ) : null}
    </section>
  );
}

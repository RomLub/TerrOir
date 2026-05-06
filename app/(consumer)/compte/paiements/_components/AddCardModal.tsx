"use client";

import { useEffect, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { getStripe } from "@/lib/stripe/client";
import {
  createSetupIntentAction,
  validateAndKeepPaymentMethodAction,
} from "../actions";

export default function AddCardModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await createSetupIntentAction();
      if (cancelled) return;
      if ("error" in res) {
        setInitError(res.error);
      } else {
        setClientSecret(res.clientSecret);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-card-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-md border border-gray-200 bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-terroir-terra-700">
          Moyen de paiement
        </div>
        <h2
          id="add-card-title"
          className="mt-1 font-serif text-[24px] leading-tight text-terroir-green-700"
        >
          Ajouter une carte
        </h2>
        <p className="mt-3 text-[13px] text-gray-600">
          Ta carte sera enregistrée chez Stripe et réutilisable pour tes
          prochaines commandes.
        </p>

        <div className="mt-6">
          {initError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {initError}
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="text-[13px] text-gray-600 hover:text-gray-900"
                >
                  Fermer
                </button>
              </div>
            </div>
          ) : !clientSecret ? (
            <p className="text-sm text-terroir-muted">Préparation…</p>
          ) : (
            <Elements
              stripe={getStripe()}
              options={{
                clientSecret,
                locale: "fr",
                appearance: { theme: "stripe" },
              }}
            >
              <AddCardForm onClose={onClose} onSuccess={onSuccess} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}

function AddCardForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error: setupError, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/compte/paiements`,
      },
      redirect: "if_required",
    });

    if (setupError) {
      setError(setupError.message ?? "Échec de l'ajout de la carte.");
      setSubmitting(false);
      return;
    }

    if (setupIntent?.status === "succeeded") {
      // Post-attach dedupe : Stripe attache chaque confirmSetup comme un
      // PaymentMethod distinct, même si la CB physique est identique. On
      // compare les fingerprints côté server pour detach les doublons
      // silencieusement et afficher un message à l'user.
      const pmId =
        typeof setupIntent.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id ?? null;

      if (!pmId) {
        setError("Impossible de vérifier la carte. Réessayez.");
        setSubmitting(false);
        return;
      }

      const validation = await validateAndKeepPaymentMethodAction(pmId);
      if ("error" in validation) {
        setError(validation.error);
        setSubmitting(false);
        return;
      }
      if (validation.duplicate) {
        setError(
          `Cette carte est déjà enregistrée (${validation.existing.brand} •••• ${validation.existing.last4}).`,
        );
        setSubmitting(false);
        return;
      }

      onSuccess();
      return;
    }

    // Autre statut (processing, requires_action avec redirect en cours) :
    // on laisse le flow Stripe finir. La page recharge via return_url.
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
          wallets: { applePay: "never", googlePay: "never" },
        }}
      />
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={!stripe || !elements || submitting}
          className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Enregistrement…" : "Enregistrer la carte"}
        </button>
      </div>
    </form>
  );
}

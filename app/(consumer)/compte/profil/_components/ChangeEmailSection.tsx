"use client";

// =============================================================================
// ChangeEmailSection — flow A3 change_email custom (T-013 PR2 stepper)
// =============================================================================
// Bascule depuis l'ancien flow Supabase Secure Email Change (lien magique
// asynchrone double confirmation) vers un flow custom 2 OTP successifs
// in-session :
//
//   idle           → user n'a pas encore cliqué "Modifier"
//   enter-email    → input new email + submit triggers requestOtp(step=current)
//   verify-current → input OTP 6 chiffres + bouton "Renvoyer le code" (30s)
//                    submit triggers verifyOtp(step=current). Si ok →
//                    requestOtp(step=new) auto + transition verify-new.
//   verify-new     → input OTP + renvoi. Submit triggers verifyOtp(step=new).
//                    Si ok → completeEmailChange(newEmail) auto + transition
//                    completed.
//   completed      → écran succès + indication "autres devices déconnectés"
//
// Ce commit (C2.8) implémente uniquement le scaffold + step 1 (enter-email).
// Steps 2-3-4 sont des placeholders explicites — implémentés en C2.9 / C2.10.
//
// useFormState pour la step 1 (action requestOtpAction, retour { ok, error,
// retryAfterSeconds }). useEffect pour détecter ok=true et transitionner.
// =============================================================================

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Input } from "@/components/ui";
import {
  requestOtpAction,
  type RequestOtpState,
} from "../_actions/request-otp";

type FlowStep =
  | "idle"
  | "enter-email"
  | "verify-current"
  | "verify-new"
  | "completed";

const INITIAL_REQUEST: RequestOtpState = {};

export default function ChangeEmailSection({
  currentEmail,
}: {
  currentEmail: string;
}) {
  const [step, setStep] = useState<FlowStep>("idle");
  const [newEmailValue, setNewEmailValue] = useState("");
  const [requestState, requestAction] = useFormState(
    requestOtpAction,
    INITIAL_REQUEST,
  );

  // Transition d'étape sur succès de requestOtp
  // - depuis "enter-email" → "verify-current"
  // - depuis "verify-current" → "verify-new" (re-request pour step=new)
  useEffect(() => {
    if (!requestState.ok) return;
    setStep((prev) => {
      if (prev === "enter-email") return "verify-current";
      if (prev === "verify-current") return "verify-new";
      return prev;
    });
  }, [requestState]);

  function cancelFlow() {
    setStep("idle");
    setNewEmailValue("");
  }

  return (
    <section className="mt-8 rounded-2xl border border-terroir-border bg-white p-6 shadow-sm">
      <header>
        <h2 className="text-lg font-semibold text-terroir-ink">Email</h2>
        <p className="mt-1 text-sm text-terroir-muted">
          Utilisé pour vous connecter et recevoir vos confirmations de commande.
          Le changement requiert la validation de codes envoyés à votre adresse
          actuelle puis à la nouvelle.
        </p>
      </header>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-terroir-ink">
          {currentEmail || (
            <span className="text-terroir-muted">Aucun email enregistré</span>
          )}
        </p>
        {step === "idle" ? (
          <button
            type="button"
            onClick={() => setStep("enter-email")}
            className="rounded-md border border-terroir-border bg-white px-4 py-2 text-sm font-medium text-terroir-ink transition-colors hover:bg-terroir-bg/60"
          >
            Modifier
          </button>
        ) : null}
      </div>

      {step === "enter-email" ? (
        <EnterEmailStep
          newEmailValue={newEmailValue}
          onNewEmailChange={setNewEmailValue}
          requestState={requestState}
          requestAction={requestAction}
          onCancel={cancelFlow}
        />
      ) : null}

      {step === "verify-current" ? (
        <PlaceholderStep
          title="Étape 2/3 — code envoyé à l'adresse actuelle"
          message={`Un code à 6 chiffres a été envoyé à ${currentEmail}. La saisie du code arrive dans la prochaine itération.`}
          newEmail={newEmailValue}
          onCancel={cancelFlow}
        />
      ) : null}

      {step === "verify-new" ? (
        <PlaceholderStep
          title="Étape 3/3 — code envoyé à la nouvelle adresse"
          message={`Un code à 6 chiffres a été envoyé à ${newEmailValue}. La saisie du code et la finalisation arrivent dans la prochaine itération.`}
          newEmail={newEmailValue}
          onCancel={cancelFlow}
        />
      ) : null}

      {step === "completed" ? (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-terroir-green-700">
            Email mis à jour avec succès. Vos sessions sur les autres appareils
            ont été déconnectées.
          </p>
          <button
            type="button"
            onClick={cancelFlow}
            className="rounded-md border border-terroir-border bg-white px-4 py-2 text-sm font-medium text-terroir-ink hover:bg-terroir-bg/60"
          >
            Fermer
          </button>
        </div>
      ) : null}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Step 1 : input new email + submit triggers requestOtp(step='current')
// -----------------------------------------------------------------------------
function EnterEmailStep({
  newEmailValue,
  onNewEmailChange,
  requestState,
  requestAction,
  onCancel,
}: {
  newEmailValue: string;
  onNewEmailChange: (v: string) => void;
  requestState: RequestOtpState;
  requestAction: (formData: FormData) => void;
  onCancel: () => void;
}) {
  return (
    <form action={requestAction} className="mt-6 space-y-4" noValidate>
      {/* step est fixe à "current" pour cette étape — l'OTP part à l'ancienne
          adresse pour vérifier l'identité de l'user qui initie le changement. */}
      <input type="hidden" name="step" value="current" />
      <Input
        id="new-email"
        name="newEmail"
        type="email"
        label="Nouvel email"
        autoComplete="email"
        required
        value={newEmailValue}
        onChange={(e) => onNewEmailChange(e.target.value)}
        hint="Vous recevrez d'abord un code à votre adresse actuelle, puis un autre à cette nouvelle adresse pour confirmer le changement."
      />

      {requestState.error ? (
        <p className="text-sm text-red-600" role="alert">
          {requestState.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm text-terroir-muted transition-colors hover:bg-terroir-bg/60 hover:text-terroir-ink"
        >
          Annuler
        </button>
        <SubmitButton label="Envoyer le code" pendingLabel="Envoi…" />
      </div>
    </form>
  );
}

function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-terroir-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-terroir-green-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Placeholder pour les steps 2/3 (à implémenter en C2.9 / C2.10)
// -----------------------------------------------------------------------------
function PlaceholderStep({
  title,
  message,
  onCancel,
}: {
  title: string;
  message: string;
  newEmail: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-6 space-y-3 rounded-md border border-terroir-border bg-terroir-bg/40 p-4">
      <p className="text-sm font-medium text-terroir-ink">{title}</p>
      <p className="text-sm text-terroir-muted">{message}</p>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-terroir-border bg-white px-3 py-1.5 text-xs font-medium text-terroir-ink hover:bg-terroir-bg/60"
      >
        Annuler
      </button>
    </div>
  );
}

"use client";

// =============================================================================
// VerifyOtpStep — sous-composant ChangeEmailSection (T-013 PR2 C2.9)
// =============================================================================
// Réutilisable pour les étapes 2 (verify step=current) et 3 (verify step=new)
// du flow A3 change_email. Paramétré via stepName + targetDescription pour
// éviter la duplication de UI (~80 lignes économisées).
//
// Spec :
//   - Input 6 chiffres (autoComplete one-time-code, inputMode numeric)
//   - Bouton "Renvoyer le code" disabled 30s (cooldown timer interne)
//   - Submit triggers verifyOtpAction(stepName, code)
//   - Resend triggers requestOtpAction(stepName, newEmail) avec reset cooldown
//   - Mapping FR des reasons d'échec via verifyOtpReasonToMessage
//
// Le chaining post-verify (verify-current ok → requestOtp(step=new), ou
// verify-new ok → completeEmailChange) est géré par le parent
// ChangeEmailSection via useEffect sur verifyState.
// =============================================================================

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Input } from "@/components/ui";
import { type VerifyOtpState } from "../_actions/verify-otp";

const RESEND_COOLDOWN_SECONDS = 30;

export function VerifyOtpStep({
  stepName,
  newEmailValue,
  targetDescription,
  verifyState,
  verifyAction,
  requestAction,
  onCancel,
}: {
  stepName: "current" | "new";
  newEmailValue: string;
  targetDescription: string;
  verifyState: VerifyOtpState;
  verifyAction: (formData: FormData) => void;
  requestAction: (formData: FormData) => void;
  onCancel: () => void;
}) {
  const [cooldownSeconds, setCooldownSeconds] = useState(
    RESEND_COOLDOWN_SECONDS,
  );

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const id = setTimeout(
      () => setCooldownSeconds((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearTimeout(id);
  }, [cooldownSeconds]);

  function handleResend() {
    const fd = new FormData();
    fd.set("step", stepName);
    fd.set("newEmail", newEmailValue);
    requestAction(fd);
    setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
  }

  return (
    <form action={verifyAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="step" value={stepName} />
      <p className="text-sm text-terroir-ink">
        Saisissez le code à 6 chiffres reçu {targetDescription}.
      </p>

      <Input
        id={`otp-${stepName}`}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        label="Code à 6 chiffres"
        required
      />

      {verifyState.reason ? (
        <p className="text-sm text-red-600" role="alert">
          {verifyOtpReasonToMessage(verifyState)}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldownSeconds > 0}
          className="text-xs text-terroir-muted underline transition-colors hover:text-terroir-ink disabled:no-underline disabled:opacity-50 disabled:hover:text-terroir-muted"
        >
          {cooldownSeconds > 0
            ? `Renvoyer dans ${cooldownSeconds}s`
            : "Renvoyer le code"}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm text-terroir-muted transition-colors hover:bg-terroir-bg/60 hover:text-terroir-ink"
          >
            Annuler
          </button>
          <VerifySubmitButton />
        </div>
      </div>
    </form>
  );
}

function VerifySubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-terroir-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-terroir-green-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Validation…" : "Valider"}
    </button>
  );
}

function verifyOtpReasonToMessage(state: VerifyOtpState): string {
  switch (state.reason) {
    case "session":
      return "Session expirée. Reconnecte-toi.";
    case "format":
      return "Le code doit contenir 6 chiffres.";
    case "no_active":
      return "Aucun code actif. Demande un nouveau code via 'Renvoyer'.";
    case "expired":
      return "Code expiré. Demande un nouveau code via 'Renvoyer'.";
    case "attempts_exceeded":
      return "Trop de tentatives. Demande un nouveau code via 'Renvoyer'.";
    case "invalid":
      return state.attemptsRemaining !== undefined
        ? `Code incorrect. Il te reste ${state.attemptsRemaining} tentative${
            state.attemptsRemaining > 1 ? "s" : ""
          }.`
        : "Code incorrect.";
    default:
      return "Erreur inconnue.";
  }
}

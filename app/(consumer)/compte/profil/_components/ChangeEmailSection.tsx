"use client";

// =============================================================================
// ChangeEmailSection — flow A3 change_email custom (T-013 PR2 stepper)
// =============================================================================
// Flow custom 2 OTP successifs in-session (modèle Amazon-like) qui remplace
// l'ancien Supabase Secure Email Change (lien magique asynchrone double
// confirmation). Cf. lib/email-change/* + _actions/{request,verify}-otp +
// _actions/complete-email-change.
//
//   idle           → user n'a pas encore cliqué "Modifier"
//   enter-email    → input new email + submit triggers requestOtp(step=current)
//   verify-current → input OTP 6 chiffres + bouton "Renvoyer" (cooldown 30s).
//                    submit triggers verifyOtp(step=current). Si ok → request
//                    Otp(step=new) auto-déclenché + transition verify-new.
//   verify-new     → input OTP + renvoi. Submit triggers verifyOtp(step=new).
//                    Si ok → completeEmailChange(newEmail) auto-déclenché.
//                    Si complete ok → transition completed.
//                    Si complete erreur → message inline + Recommencer.
//   completed      → écran succès + indication "autres devices déconnectés"
//
// 3 useFormState chaînés : request, verify, complete. 3 useEffect orchestrent
// les transitions automatiques sur ok=true des actions précédentes.
// =============================================================================

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Input } from "@/components/ui";
import {
  requestOtpAction,
  type RequestOtpState,
} from "../_actions/request-otp";
import {
  verifyOtpAction,
  type VerifyOtpState,
} from "../_actions/verify-otp";
import {
  completeEmailChangeAction,
  type CompleteEmailChangeState,
} from "../_actions/complete-email-change";
import { VerifyOtpStep } from "./ChangeEmailVerifyOtpStep";
import {
  CompletedStep,
  CompleteErrorPanel,
} from "./ChangeEmailCompletedStep";

type FlowStep =
  | "idle"
  | "enter-email"
  | "verify-current"
  | "verify-new"
  | "completed";

const INITIAL_REQUEST: RequestOtpState = {};
const INITIAL_VERIFY: VerifyOtpState = {};
const INITIAL_COMPLETE: CompleteEmailChangeState = {};

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
  const [verifyState, verifyAction] = useFormState(
    verifyOtpAction,
    INITIAL_VERIFY,
  );
  const [completeState, completeAction] = useFormState(
    completeEmailChangeAction,
    INITIAL_COMPLETE,
  );

  // Transition d'étape sur succès de requestOtp :
  //   enter-email → verify-current  (request initial step=current)
  //   verify-current → verify-new   (request step=new auto-déclenché)
  useEffect(() => {
    if (!requestState.ok) return;
    setStep((prev) => {
      if (prev === "enter-email") return "verify-current";
      if (prev === "verify-current") return "verify-new";
      return prev;
    });
  }, [requestState]);

  // Chaining post-verify :
  //   verify(current) ok → trigger requestOtp(step=new) auto
  //   verify(new) ok     → trigger completeEmailChange auto
  useEffect(() => {
    if (!verifyState.ok) return;
    if (step === "verify-current") {
      const fd = new FormData();
      fd.set("step", "new");
      fd.set("newEmail", newEmailValue);
      requestAction(fd);
    }
    if (step === "verify-new") {
      const fd = new FormData();
      fd.set("newEmail", newEmailValue);
      completeAction(fd);
    }
  }, [verifyState, step, newEmailValue, requestAction, completeAction]);

  // Transition finale : complete ok → completed
  useEffect(() => {
    if (completeState.ok) {
      setStep("completed");
    }
  }, [completeState]);

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
        <VerifyOtpStep
          stepName="current"
          newEmailValue={newEmailValue}
          targetDescription={`à votre adresse actuelle (${currentEmail})`}
          verifyState={verifyState}
          verifyAction={verifyAction}
          requestAction={requestAction}
          onCancel={cancelFlow}
        />
      ) : null}

      {step === "verify-new" ? (
        completeState.reason ? (
          <CompleteErrorPanel
            reason={completeState.reason}
            onRestart={cancelFlow}
          />
        ) : (
          <VerifyOtpStep
            stepName="new"
            newEmailValue={newEmailValue}
            targetDescription={`à ${newEmailValue}`}
            verifyState={verifyState}
            verifyAction={verifyAction}
            requestAction={requestAction}
            onCancel={cancelFlow}
          />
        )
      ) : null}

      {step === "completed" ? (
        <CompletedStep newEmail={newEmailValue} onClose={cancelFlow} />
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
      {/* step fixe à "current" pour cette étape — l'OTP part à l'ancienne
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  loginAction,
  requestMagicLinkAction,
  type LoginState,
  type MagicLinkState,
} from "./actions";
import {
  clearSavedEmail,
  getSavedEmail,
  setSavedEmail,
} from "@/lib/storage/local-preferences";
import { PasswordInput } from "@/components/ui";

const initialLoginState: LoginState = {};
const initialMagicLinkState: MagicLinkState = {};

type Mode = "password" | "magic";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-terroir-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green/90 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

// Hook partagé : pré-remplit l'email depuis localStorage et gère la
// case "Se souvenir de mon email". Persiste l'email au submit si la
// case est cochée, sinon purge la clé.
function useRememberedEmail() {
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const saved = getSavedEmail();
    if (saved) {
      setEmail(saved);
      setRemember(true);
    }
  }, []);

  const persistOnSubmit = () => {
    if (remember && email) {
      setSavedEmail(email);
    } else {
      clearSavedEmail();
    }
  };

  const forget = () => {
    clearSavedEmail();
    setEmail("");
    setRemember(false);
  };

  return { email, setEmail, remember, setRemember, persistOnSubmit, forget };
}

function RememberEmailFields({
  email,
  setEmail,
  remember,
  setRemember,
  forget,
}: {
  email: string;
  setEmail: (v: string) => void;
  remember: boolean;
  setRemember: (v: boolean) => void;
  forget: () => void;
}) {
  return (
    <>
      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </label>

      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-terroir-ink">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span>Se souvenir de mon adresse email</span>
        </label>
        {email ? (
          <button
            type="button"
            onClick={forget}
            className="text-xs text-terroir-muted underline hover:text-terroir-green"
          >
            Effacer
          </button>
        ) : null}
      </div>
    </>
  );
}

export function ConnexionForm({
  redirectTo,
  callbackError,
}: {
  redirectTo?: string;
  callbackError?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("password");

  return mode === "password" ? (
    <PasswordForm
      redirectTo={redirectTo}
      callbackError={callbackError}
      onSwitchToMagic={() => setMode("magic")}
    />
  ) : (
    <MagicLinkForm
      redirectTo={redirectTo}
      onSwitchToPassword={() => setMode("password")}
    />
  );
}

function PasswordForm({
  redirectTo,
  callbackError,
  onSwitchToMagic,
}: {
  redirectTo?: string;
  callbackError?: string | null;
  onSwitchToMagic: () => void;
}) {
  const [state, formAction] = useFormState(loginAction, initialLoginState);
  const remembered = useRememberedEmail();

  return (
    <form
      action={formAction}
      onSubmit={remembered.persistOnSubmit}
      className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 shadow-sm"
    >
      <h1 className="text-2xl font-bold text-terroir-green">Connexion</h1>

      {callbackError ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <p>{callbackError}</p>
          <button
            type="button"
            onClick={onSwitchToMagic}
            className="font-medium underline hover:opacity-80"
          >
            Demander un nouveau lien magique
          </button>
        </div>
      ) : null}

      {redirectTo ? (
        <input type="hidden" name="redirectTo" value={redirectTo} />
      ) : null}

      <RememberEmailFields
        email={remembered.email}
        setEmail={remembered.setEmail}
        remember={remembered.remember}
        setRemember={remembered.setRemember}
        forget={remembered.forget}
      />

      <PasswordInput
        label="Mot de passe"
        name="password"
        required
        autoComplete="current-password"
      />

      <div className="text-right">
        <Link
          href="/mot-de-passe-oublie"
          className="text-sm text-terroir-green hover:underline"
        >
          Mot de passe oublié ?
        </Link>
      </div>

      {state.error ? (
        <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <SubmitButton label="Se connecter" pendingLabel="Connexion..." />

      <button
        type="button"
        onClick={onSwitchToMagic}
        className="block w-full text-center text-sm text-terroir-muted underline hover:text-terroir-green"
      >
        Se connecter par email
      </button>
    </form>
  );
}

function MagicLinkForm({
  redirectTo,
  onSwitchToPassword,
}: {
  redirectTo?: string;
  onSwitchToPassword: () => void;
}) {
  const [state, formAction] = useFormState(
    requestMagicLinkAction,
    initialMagicLinkState,
  );
  const remembered = useRememberedEmail();

  if (state.message) {
    return (
      <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-terroir-green">
          Vérifiez vos emails
        </h1>
        <p className="text-sm text-terroir-ink">{state.message}</p>
        <button
          type="button"
          onClick={onSwitchToPassword}
          className="inline-block text-sm text-terroir-green underline hover:opacity-80"
        >
          Retour à la connexion par mot de passe
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={remembered.persistOnSubmit}
      className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 shadow-sm"
    >
      <h1 className="text-2xl font-bold text-terroir-green">
        Se connecter par email
      </h1>
      <p className="text-sm text-terroir-muted">
        Saisissez votre email, nous vous enverrons un lien de connexion. Pas
        besoin de mot de passe.
      </p>

      {redirectTo ? (
        <input type="hidden" name="redirectTo" value={redirectTo} />
      ) : null}

      <RememberEmailFields
        email={remembered.email}
        setEmail={remembered.setEmail}
        remember={remembered.remember}
        setRemember={remembered.setRemember}
        forget={remembered.forget}
      />

      {state.error ? (
        <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <SubmitButton label="Envoyer le lien" pendingLabel="Envoi…" />

      <button
        type="button"
        onClick={onSwitchToPassword}
        className="block w-full text-center text-sm text-terroir-muted underline hover:text-terroir-green"
      >
        Retour à la connexion par mot de passe
      </button>
    </form>
  );
}

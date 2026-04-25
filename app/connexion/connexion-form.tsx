"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  loginAction,
  requestMagicLinkAction,
  type LoginState,
  type MagicLinkState,
} from "./actions";

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

export function ConnexionForm({ redirectTo }: { redirectTo?: string }) {
  const [mode, setMode] = useState<Mode>("password");

  return mode === "password" ? (
    <PasswordForm
      redirectTo={redirectTo}
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
  onSwitchToMagic,
}: {
  redirectTo?: string;
  onSwitchToMagic: () => void;
}) {
  const [state, formAction] = useFormState(loginAction, initialLoginState);

  return (
    <form
      action={formAction}
      className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 shadow-sm"
    >
      <h1 className="text-2xl font-bold text-terroir-green">Connexion</h1>

      {redirectTo ? (
        <input type="hidden" name="redirectTo" value={redirectTo} />
      ) : null}

      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Mot de passe</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </label>

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

      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </label>

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

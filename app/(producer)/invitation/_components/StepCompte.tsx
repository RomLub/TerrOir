"use client";

import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  createAccountAction,
  type State as CreateState,
} from "../_actions/create-account";
import {
  loginAndUpgradeAction,
  type State as LoginState,
} from "../_actions/login-and-upgrade";

const initialCreate: CreateState = {};
const initialLogin: LoginState = {};

function PrimaryButton({
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
      className="w-full rounded-md bg-terroir-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green-700/90 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700";

const readOnlyClass =
  "w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700";

export function StepCompteNew({
  token,
  email,
  onSuccess,
}: {
  token: string;
  email: string;
  onSuccess: () => void;
}) {
  const [state, action] = useFormState(createAccountAction, initialCreate);

  useEffect(() => {
    if (state.success) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input
        type="hidden"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
      />

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Email
        </label>
        <input type="email" value={email} readOnly disabled className={readOnlyClass} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Mot de passe
        </label>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Confirmer le mot de passe
        </label>
        <input
          name="passwordConfirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}

      <PrimaryButton label="Créer mon compte" pendingLabel="Création…" />
    </form>
  );
}

export function StepCompteLogin({
  token,
  email,
  onSuccess,
}: {
  token: string;
  email: string;
  onSuccess: () => void;
}) {
  const [state, action] = useFormState(loginAndUpgradeAction, initialLogin);

  useEffect(() => {
    if (state.success) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input
        type="hidden"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
      />

      <p className="text-sm text-gray-600">
        Un compte existe déjà avec cet email. Connectez-vous pour activer votre
        profil producteur.
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Email
        </label>
        <input type="email" value={email} readOnly disabled className={readOnlyClass} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Mot de passe
        </label>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>

      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}

      <PrimaryButton
        label="Se connecter et continuer"
        pendingLabel="Connexion…"
      />
    </form>
  );
}

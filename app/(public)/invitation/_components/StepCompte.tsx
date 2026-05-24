"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createAccountAction,
  type State as CreateState,
} from "../_actions/create-account";
import {
  loginAndUpgradeAction,
  type State as LoginState,
} from "../_actions/login-and-upgrade";
import { Input, PasswordInput } from "@/components/ui";

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

const readOnlyClass =
  "w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700";

export function StepCompteNew({
  token,
  email,
  defaults,
  onSuccess,
}: {
  token: string;
  email: string;
  // Identité pré-remplie depuis le lead matché (refonte funnel : le perso est
  // collecté ici, plus à l'étape 2). Champs vides si aucun lead.
  defaults?: { prenom: string; nom: string; telephone: string };
  onSuccess: () => void;
}) {
  const [state, action] = useActionState(createAccountAction, initialCreate);

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Prénom"
          name="prenom"
          required
          autoComplete="given-name"
          defaultValue={defaults?.prenom ?? ""}
        />
        <Input
          label="Nom"
          name="nom"
          required
          autoComplete="family-name"
          defaultValue={defaults?.nom ?? ""}
        />
      </div>

      <Input
        label="Téléphone"
        name="telephone"
        type="tel"
        required
        autoComplete="tel"
        placeholder="06 12 34 56 78"
        defaultValue={defaults?.telephone ?? ""}
      />

      <PasswordInput
        label="Mot de passe"
        name="password"
        required
        minLength={8}
        autoComplete="new-password"
      />

      <PasswordInput
        label="Confirmer le mot de passe"
        name="passwordConfirm"
        required
        minLength={8}
        autoComplete="new-password"
      />

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
  const [state, action] = useActionState(loginAndUpgradeAction, initialLogin);

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

      <PasswordInput
        label="Mot de passe"
        name="password"
        required
        autoComplete="current-password"
      />

      <div className="text-right">
        <Link
          href="/mot-de-passe-oublie"
          className="text-sm text-terroir-green-700 underline hover:text-terroir-green-700/80"
        >
          Mot de passe oublié&nbsp;?
        </Link>
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

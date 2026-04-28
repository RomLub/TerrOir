"use client";

import { useFormState, useFormStatus } from "react-dom";
import { signupAction, type SignupState } from "./actions";
import { PasswordInput } from "@/components/ui";

const initialState: SignupState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-terroir-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green/90 disabled:opacity-60"
    >
      {pending ? "Création..." : "Créer mon compte"}
    </button>
  );
}

export default function InscriptionPage() {
  const [state, formAction] = useFormState(signupAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form
        action={formAction}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-bold text-terroir-green">
          Créer un compte
        </h1>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Prénom</span>
            <input
              name="prenom"
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Nom</span>
            <input
              name="nom"
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        </div>

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

        <PasswordInput
          label="Mot de passe"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
        />

        <label className="block">
          <span className="text-sm font-medium">
            Téléphone <span className="text-gray-500">(optionnel)</span>
          </span>
          <input
            name="telephone"
            type="tel"
            autoComplete="tel"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            name="sms_optin"
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className="text-sm">Recevoir les rappels par SMS</span>
        </label>

        {state.error ? (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            {state.error}
          </p>
        ) : null}

        <SubmitButton />
      </form>
    </main>
  );
}

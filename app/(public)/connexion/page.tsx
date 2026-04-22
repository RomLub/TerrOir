"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-terroir-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green/90 disabled:opacity-60"
    >
      {pending ? "Connexion..." : "Se connecter"}
    </button>
  );
}

export default function ConnexionPage() {
  const [state, formAction] = useFormState(loginAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form
        action={formAction}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-bold text-terroir-green">Connexion</h1>

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

        <SubmitButton />
      </form>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signupAction, type SignupState } from "./actions";
import { PasswordInput } from "@/components/ui";

const initialState: SignupState = {};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full rounded-md bg-terroir-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green/90 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? "Création..." : "Créer mon compte"}
    </button>
  );
}

export default function InscriptionPage() {
  const [state, formAction] = useActionState(signupAction, initialState);
  const [cguAccepted, setCguAccepted] = useState(false);

  if (state.success) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-terroir-green">
            Vérifie tes emails
          </h1>
          <p className="text-sm text-terroir-ink">
            Un mail de confirmation a été envoyé à{" "}
            <strong>{state.success.email}</strong>. Clique sur le lien pour
            activer ton compte.
          </p>
          <p className="text-xs text-terroir-muted">
            Pense à consulter tes spams si tu ne le trouves pas.
          </p>
          <Link
            href="/connexion"
            className="inline-block text-sm text-terroir-green underline hover:opacity-80"
          >
            Retour à la connexion
          </Link>
        </div>
      </main>
    );
  }

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

        <label className="flex items-start gap-2">
          <input
            name="cgu_accepted"
            type="checkbox"
            required
            checked={cguAccepted}
            onChange={(e) => setCguAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <span className="text-sm leading-relaxed">
            J&rsquo;ai lu et j&rsquo;accepte les{" "}
            <Link
              href="/cgu"
              target="_blank"
              rel="noopener"
              className="text-terroir-green underline hover:opacity-80"
            >
              Conditions générales d&rsquo;utilisation
            </Link>{" "}
            et la{" "}
            <Link
              href="/politique-confidentialite"
              target="_blank"
              rel="noopener"
              className="text-terroir-green underline hover:opacity-80"
            >
              Politique de confidentialité
            </Link>
          </span>
        </label>

        {state.error ? (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
            {state.error}
          </p>
        ) : null}

        <SubmitButton disabled={!cguAccepted} />
      </form>
    </main>
  );
}

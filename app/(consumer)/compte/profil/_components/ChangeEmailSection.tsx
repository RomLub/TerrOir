"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Input } from "@/components/ui";
import {
  changeEmailAction,
  type ChangeEmailState,
} from "../_actions/change-email";

const INITIAL: ChangeEmailState = {};

export default function ChangeEmailSection({
  currentEmail,
}: {
  currentEmail: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useFormState(changeEmailAction, INITIAL);

  return (
    <section className="mt-8 rounded-2xl border border-terroir-border bg-white p-6 shadow-sm">
      <header>
        <h2 className="text-lg font-semibold text-terroir-ink">Email</h2>
        <p className="mt-1 text-sm text-terroir-muted">
          Utilisé pour vous connecter et recevoir vos confirmations de
          commande.
        </p>
      </header>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-terroir-ink">
          {currentEmail || (
            <span className="text-terroir-muted">Aucun email enregistré</span>
          )}
        </p>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-terroir-border bg-white px-4 py-2 text-sm font-medium text-terroir-ink transition-colors hover:bg-terroir-bg/60"
          >
            Modifier
          </button>
        ) : null}
      </div>

      {editing ? (
        <form action={formAction} className="mt-6 space-y-4" noValidate>
          <Input
            id="new-email"
            name="email"
            type="email"
            label="Nouvel email"
            autoComplete="email"
            required
            hint="Vous recevrez un email de confirmation aux 2 adresses (ancienne + nouvelle). Le changement n'est effectif qu'après validation."
          />

          {state.error ? (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.message ? (
            <p className="text-sm text-terroir-green-700" role="status">
              {state.message}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-4 py-2 text-sm text-terroir-muted transition-colors hover:bg-terroir-bg/60 hover:text-terroir-ink"
            >
              Annuler
            </button>
            <ChangeEmailSubmitButton />
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ChangeEmailSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-terroir-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-terroir-green-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Envoi…" : "Envoyer le lien de confirmation"}
    </button>
  );
}

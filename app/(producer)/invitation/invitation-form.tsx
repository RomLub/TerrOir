"use client";

import { useFormState, useFormStatus } from "react-dom";
import { acceptInvitationAction, type AcceptState } from "./actions";

const initialState: AcceptState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-terroir-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green/90 disabled:opacity-60"
    >
      {pending ? "Activation..." : "Activer mon compte"}
    </button>
  );
}

export default function InvitationForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(acceptInvitationAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />

      <label className="block">
        <span className="text-sm font-medium">Mot de passe</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
        />
      </label>

      {state.error ? (
        <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

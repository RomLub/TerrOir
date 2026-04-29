"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  acceptInvitationAction,
  type State,
} from "../_actions/accept-invitation";

const initial: State = {};

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

export function InvitationConfirmCard({
  token,
  email,
  prenom,
}: {
  token: string;
  email: string;
  prenom: string | null;
}) {
  const [state, action] = useFormState(acceptInvitationAction, initial);

  return (
    <div className="w-full max-w-xl rounded-2xl border border-terroir-border bg-white p-8 shadow-sm">
      <h1 className="font-serif text-2xl text-terroir-green-700">
        {prenom ? `Bienvenue ${prenom}` : "Bienvenue sur TerrOir"}
      </h1>
      <p className="mt-3 text-sm text-gray-700">
        Vous avez reçu une invitation à devenir producteur sur TerrOir. En
        acceptant, vous ajoutez le rôle producteur à votre compte
        ({email}) — vous pourrez ensuite compléter votre profil
        d&apos;exploitation.
      </p>

      <form action={action} className="mt-6 space-y-3">
        <input type="hidden" name="token" value={token} />

        {state.error ? (
          <p className="text-sm text-red-700" role="alert">
            {state.error}
          </p>
        ) : null}

        <PrimaryButton
          label="Accepter et devenir producteur"
          pendingLabel="Validation…"
        />
      </form>

      <Link
        href="/"
        className="mt-4 block text-center text-sm text-gray-600 underline hover:text-gray-800"
      >
        Plus tard
      </Link>
    </div>
  );
}

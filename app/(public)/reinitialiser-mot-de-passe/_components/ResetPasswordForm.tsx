"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { Button, PasswordInput } from "@/components/ui";
import {
  updatePasswordAction,
  type UpdatePasswordState,
} from "../_actions/update-password";

const initialState: UpdatePasswordState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Enregistrement…" : "Définir mon nouveau mot de passe"}
    </Button>
  );
}

export function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const [state, formAction] = useFormState(updatePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token_hash" value={tokenHash} />

      <PasswordInput
        label="Nouveau mot de passe"
        name="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <PasswordInput
        label="Confirmer le mot de passe"
        name="passwordConfirm"
        autoComplete="new-password"
        minLength={8}
        required
      />

      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {state.error}
          {state.expired ? (
            <div className="mt-2">
              <Link
                href="/mot-de-passe-oublie"
                className="underline font-medium"
              >
                Demander un nouveau lien
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <SubmitButton />
    </form>
  );
}

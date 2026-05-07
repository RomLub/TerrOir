"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useUserContext } from "@/components/providers/user-provider";
import { Button, PasswordInput } from "@/components/ui";
import {
  changePasswordAction,
  type ChangePasswordState,
} from "./_actions/change-password";

const INITIAL: ChangePasswordState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? "Enregistrement…" : "Modifier"}
    </Button>
  );
}

export default function PasswordPage() {
  const { user } = useUserContext();
  const email = user?.email ?? "";
  const [state, formAction] = useActionState(changePasswordAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset les champs après un changement réussi pour éviter qu'un mdp
  // saisi reste exposé en mémoire DOM (cohérence avec l'ancienne UX
  // controlled qui faisait setCurrentPassword("")).
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <main className="mx-auto max-w-2xl">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-terra-700">
          Mon compte
        </p>
        <h1 className="mt-2 font-serif text-[40px] leading-tight text-terroir-green-700">
          Mot de passe
        </h1>
        <p className="mt-2 text-sm text-terroir-muted">
          Change ton mot de passe. Minimum 8 caractères avec une majuscule,
          une minuscule et un chiffre.
        </p>
      </header>

      <form
        ref={formRef}
        action={formAction}
        className="space-y-4 rounded-2xl border border-terroir-border bg-white p-6 shadow-sm"
        noValidate
      >
        {email ? (
          <input
            type="hidden"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
          />
        ) : null}

        <PasswordInput
          name="currentPassword"
          label="Mot de passe actuel"
          autoComplete="current-password"
          required
        />

        <PasswordInput
          name="newPassword"
          label="Nouveau mot de passe"
          autoComplete="new-password"
          minLength={8}
          required
        />

        <PasswordInput
          name="newPasswordConfirm"
          label="Confirmer le nouveau mot de passe"
          autoComplete="new-password"
          minLength={8}
          required
        />

        {state.error ? (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-4 pt-2">
          {state.success ? (
            <span className="text-sm text-terroir-green-700" role="status">
              Mot de passe modifié.
            </span>
          ) : null}
          <SubmitButton />
        </div>
      </form>
    </main>
  );
}

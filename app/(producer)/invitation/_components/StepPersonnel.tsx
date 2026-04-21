"use client";

import { useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  updatePersonalInfoAction,
  type State,
} from "../_actions/update-personal-info";

const initial: State = {};

const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700";

function SubmitBtn({
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
      className="rounded-md bg-terroir-green-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green-700/90 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function StepPersonnel({
  token,
  initialValues,
  onSuccess,
  onBack,
}: {
  token: string;
  initialValues: { prenom: string; nom: string; telephone: string };
  onSuccess: () => void;
  onBack?: () => void;
}) {
  const [state, action] = useFormState(updatePersonalInfoAction, initial);

  useEffect(() => {
    if (state.success) onSuccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-800">
            Prénom
          </label>
          <input
            name="prenom"
            type="text"
            required
            autoComplete="given-name"
            defaultValue={initialValues.prenom}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-800">
            Nom
          </label>
          <input
            name="nom"
            type="text"
            required
            autoComplete="family-name"
            defaultValue={initialValues.nom}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Téléphone
        </label>
        <input
          name="telephone"
          type="tel"
          required
          autoComplete="tel"
          defaultValue={initialValues.telephone}
          placeholder="06 12 34 56 78"
          className={inputClass}
        />
      </div>

      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-md px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            Précédent
          </button>
        ) : null}
        <SubmitBtn label="Suivant" pendingLabel="Enregistrement…" />
      </div>
    </form>
  );
}

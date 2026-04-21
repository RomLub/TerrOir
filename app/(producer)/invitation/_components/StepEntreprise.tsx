"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  completeOnboardingAction,
  type State,
} from "../_actions/complete-onboarding";

const FORMES = [
  { value: "gaec", label: "GAEC" },
  { value: "earl", label: "EARL" },
  { value: "ei", label: "EI (Entreprise Individuelle)" },
  { value: "scea", label: "SCEA" },
  { value: "sas", label: "SAS" },
  { value: "sarl", label: "SARL" },
  { value: "autre", label: "Autre" },
];

const TYPES = [
  { value: "maraichage", label: "Maraîchage" },
  { value: "elevage", label: "Élevage" },
  { value: "laiterie", label: "Laiterie" },
  { value: "boulangerie", label: "Boulangerie" },
  { value: "vin", label: "Vin" },
  { value: "arboriculture", label: "Arboriculture" },
  { value: "apiculture", label: "Apiculture" },
  { value: "autre", label: "Autre" },
];

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

export function StepEntreprise({
  token,
  initialValues,
  onBack,
}: {
  token: string;
  initialValues: {
    nom_exploitation: string;
    forme_juridique: string;
    siret: string;
    adresse: string;
    code_postal: string;
    commune: string;
    type_production: string;
    type_production_precision: string;
  };
  onBack?: () => void;
}) {
  const [typeProduction, setTypeProduction] = useState(
    initialValues.type_production,
  );
  const [state, action] = useFormState(completeOnboardingAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Nom de l&apos;exploitation
        </label>
        <input
          name="nom_exploitation"
          type="text"
          required
          defaultValue={initialValues.nom_exploitation}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-800">
            Forme juridique
          </label>
          <select
            name="forme_juridique"
            required
            defaultValue={initialValues.forme_juridique}
            className={inputClass}
          >
            <option value="" disabled>
              Choisir…
            </option>
            {FORMES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-800">
            SIRET
          </label>
          <input
            name="siret"
            type="text"
            required
            inputMode="numeric"
            pattern="\d{14}"
            placeholder="14 chiffres"
            defaultValue={initialValues.siret}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Adresse
        </label>
        <input
          name="adresse"
          type="text"
          required
          autoComplete="street-address"
          defaultValue={initialValues.adresse}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-800">
            Code postal
          </label>
          <input
            name="code_postal"
            type="text"
            required
            inputMode="numeric"
            pattern="\d{5}"
            autoComplete="postal-code"
            defaultValue={initialValues.code_postal}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-800">
            Commune
          </label>
          <input
            name="commune"
            type="text"
            required
            autoComplete="address-level2"
            defaultValue={initialValues.commune}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Type de production
        </label>
        <select
          name="type_production"
          required
          value={typeProduction}
          onChange={(e) => setTypeProduction(e.target.value)}
          className={inputClass}
        >
          <option value="" disabled>
            Choisir…
          </option>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {typeProduction === "autre" ? (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-800">
            Précisez votre type de production
          </label>
          <input
            name="type_production_precision"
            type="text"
            required
            defaultValue={initialValues.type_production_precision}
            className={inputClass}
          />
        </div>
      ) : null}

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
        <SubmitBtn label="Finaliser ma demande" pendingLabel="Envoi…" />
      </div>
    </form>
  );
}

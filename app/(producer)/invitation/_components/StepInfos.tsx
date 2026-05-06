"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  completeOnboardingAction,
  type State,
} from "../_actions/complete-onboarding";
import {
  ALIMENTATION_HINTS,
  ALIMENTATION_LABELS,
  ALIMENTATION_VALUES,
  DENSITE_ANIMALE_HINTS,
  DENSITE_ANIMALE_LABELS,
  DENSITE_ANIMALE_VALUES,
  MODE_ELEVAGE_HINTS,
  MODE_ELEVAGE_LABELS,
  MODE_ELEVAGE_VALUES,
  type Alimentation,
  type DensiteAnimale,
  type ModeElevage,
} from "@/lib/producers/score-carbone-enums";
import { getDeclarationVeraciteText } from "@/lib/producers/declaration-veracite";
import { ScoreCarbonPreview } from "@/components/producer/ScoreCarbonPreview";
import { HelpTooltip } from "./HelpTooltip";

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

export function StepInfos({
  token,
  initialValues,
  onBack,
}: {
  token: string;
  initialValues: {
    prenom: string;
    nom: string;
    telephone: string;
    prenom_affichage: string;
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
  // T-212 — états contrôlés des 3 enums score carbone pour brancher
  // ScoreCarbonPreview en direct. La submission reste basée sur FormData
  // (radio name=...) → pas d'impact côté action complete-onboarding.
  const [modeElevage, setModeElevage] = useState<ModeElevage | null>(null);
  const [alimentation, setAlimentation] = useState<Alimentation | null>(null);
  const [densiteAnimale, setDensiteAnimale] = useState<DensiteAnimale | null>(
    null,
  );
  const [state, action] = useFormState(completeOnboardingAction, initial);

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

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Prénom d&apos;affichage
        </label>
        <input
          name="prenom_affichage"
          type="text"
          required
          maxLength={50}
          defaultValue={initialValues.prenom_affichage}
          placeholder="Julien, Julien et Marie, La famille Durand…"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-gray-500">
          Visible sur vos produits. Ce prénom signera vos conseils aux clients.
        </p>
      </div>

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

      <div className="space-y-4 rounded-md border border-gray-200 bg-gray-50/50 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-green-700">
            Score carbone & bien-être animal
          </p>
          <p className="mt-1 text-sm text-gray-700">
            Facultatif — ces infos enrichissent ta fiche publique et permettent
            aux clients de mieux comprendre ton mode de production.
          </p>
        </div>

        {/* T-212 — Layout 2 colonnes desktop : sélecteurs à gauche, aperçu
            sticky à droite. Mobile : pile vertical (preview au-dessous). */}
        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 flex items-center text-sm font-medium text-gray-800">
                Mode d&apos;élevage
                <HelpTooltip
                  id="tip-mode-elevage"
                  ariaLabel="Aide : mode d'élevage"
                >
                  <strong className="block font-semibold text-gray-900">
                    Comment situer ton élevage ?
                  </strong>
                  Choisis l&rsquo;option qui décrit le mieux la conduite
                  habituelle de tes animaux : où ils passent la majeure
                  partie de leur temps (extérieur, pâture saisonnière,
                  bâtiment avec ou sans accès libre au parcours).
                </HelpTooltip>
              </legend>
              {MODE_ELEVAGE_VALUES.map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer select-none items-start gap-3 rounded-md border border-gray-200 bg-white p-3 hover:border-terroir-green-700/40"
                >
                  <input
                    type="radio"
                    name="mode_elevage"
                    value={v}
                    checked={modeElevage === v}
                    onChange={() => setModeElevage(v)}
                    className="mt-1 h-4 w-4 accent-terroir-green-700"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {MODE_ELEVAGE_LABELS[v]}
                    </span>
                    <span className="text-xs text-gray-500">
                      {MODE_ELEVAGE_HINTS[v]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-1 flex items-center text-sm font-medium text-gray-800">
                Alimentation
                <HelpTooltip
                  id="tip-alimentation"
                  ariaLabel="Aide : alimentation"
                >
                  <strong className="block font-semibold text-gray-900">
                    D&rsquo;où vient l&rsquo;alimentation ?
                  </strong>
                  Choisis l&rsquo;option qui reflète la part dominante de
                  l&rsquo;alimentation de tes animaux sur l&rsquo;année :
                  pâture/fourrage de la ferme, mix avec compléments
                  achetés, ou alimentation principalement achetée.
                </HelpTooltip>
              </legend>
              {ALIMENTATION_VALUES.map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer select-none items-start gap-3 rounded-md border border-gray-200 bg-white p-3 hover:border-terroir-green-700/40"
                >
                  <input
                    type="radio"
                    name="alimentation"
                    value={v}
                    checked={alimentation === v}
                    onChange={() => setAlimentation(v)}
                    className="mt-1 h-4 w-4 accent-terroir-green-700"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {ALIMENTATION_LABELS[v]}
                    </span>
                    <span className="text-xs text-gray-500">
                      {ALIMENTATION_HINTS[v]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-1 flex items-center text-sm font-medium text-gray-800">
                Densité animale
                <HelpTooltip
                  id="tip-densite-animale"
                  ariaLabel="Aide : densité animale"
                >
                  <strong className="block font-semibold text-gray-900">
                    Combien d&rsquo;espace par animal ?
                  </strong>
                  Estimation qualitative de la place dont disposent tes
                  animaux : extensive si beaucoup d&rsquo;espace par tête
                  (faible chargement à l&rsquo;hectare), standard pour la
                  densité usuelle en élevage fermier, intensive pour une
                  conduite avec infrastructure d&rsquo;élevage adaptée.
                </HelpTooltip>
              </legend>
              {DENSITE_ANIMALE_VALUES.map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer select-none items-start gap-3 rounded-md border border-gray-200 bg-white p-3 hover:border-terroir-green-700/40"
                >
                  <input
                    type="radio"
                    name="densite_animale"
                    value={v}
                    checked={densiteAnimale === v}
                    onChange={() => setDensiteAnimale(v)}
                    className="mt-1 h-4 w-4 accent-terroir-green-700"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {DENSITE_ANIMALE_LABELS[v]}
                    </span>
                    <span className="text-xs text-gray-500">
                      {DENSITE_ANIMALE_HINTS[v]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          <div className="md:sticky md:top-4 md:self-start">
            <ScoreCarbonPreview
              modeElevage={modeElevage}
              alimentation={alimentation}
              densiteAnimale={densiteAnimale}
            />
          </div>
        </div>

        <label
          className={`flex cursor-pointer select-none items-start gap-3 rounded-md border p-3 ${
            state.errorField === "declaration_indicateurs_veracite"
              ? "border-red-500 bg-red-50/50"
              : "border-amber-200 bg-amber-50/50"
          }`}
        >
          <input
            type="checkbox"
            name="declaration_indicateurs_veracite"
            aria-invalid={
              state.errorField === "declaration_indicateurs_veracite"
                ? true
                : undefined
            }
            aria-describedby={
              state.errorField === "declaration_indicateurs_veracite"
                ? "declaration-indicateurs-error"
                : undefined
            }
            className="mt-1 h-4 w-4 accent-terroir-green-700"
          />
          <span className="text-xs text-gray-700">
            {/* Source unique du wording certifié : helper versionné — évite */}
            {/* la dérive entre l'UI et la trace probatoire archivée en base */}
            {/* (declaration_indicateurs_wording_version). Bumper la version */}
            {/* dans le helper suffit à propager le nouveau texte ici. */}
            {getDeclarationVeraciteText()}
          </span>
        </label>
        {state.errorField === "declaration_indicateurs_veracite" ? (
          <p
            id="declaration-indicateurs-error"
            role="alert"
            className="text-sm text-red-700"
          >
            {state.error}
          </p>
        ) : null}
      </div>

      {state.error &&
      state.errorField !== "declaration_indicateurs_veracite" ? (
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

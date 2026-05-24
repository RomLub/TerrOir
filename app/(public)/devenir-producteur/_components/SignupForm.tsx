"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { Button, Input } from "@/components/ui";
import {
  signupProducerAction,
  type ProducerSignupState,
} from "../_actions/signup-producer";
import { becomeProducerAction } from "../_actions/become-producer";

// Refonte funnel 2 étapes — ÉTAPE 1 : identité / compte uniquement.
// Les infos d'exploitation (nom, commune, SIRET, type de production, message…)
// sont saisies à l'ÉTAPE 2 (/onboarding, StepInfos), où l'on est redirigé
// aussitôt le compte créé.

export type PrefillData = {
  token: string;
  email: string;
  prenom: string;
  nom: string;
  telephone: string;
};

export type LoggedInProfile = {
  email: string;
  prenom: string;
  nom: string;
  telephone: string;
};

export function SignupForm({
  prefill,
  loggedIn = null,
}: {
  prefill: PrefillData | null;
  // Variante « connecté » : compte existant. Identité pré-remplie et verrouillée
  // (grisée) ; pas de mot de passe. La soumission rattache le rôle producteur au
  // compte existant, puis redirige vers l'étape 2 (exploitation).
  loggedIn?: LoggedInProfile | null;
}) {
  const isLoggedIn = Boolean(loggedIn);
  const [state, formAction, isPending] = useActionState<
    ProducerSignupState,
    FormData
  >(isLoggedIn ? becomeProducerAction : signupProducerAction, {});

  // Accès immédiat : à la réussite, on navigue côté client vers l'espace
  // producteur (le cookie partagé .terroir-local.fr authentifie sur pro). Le
  // middleware renvoie ensuite un draft vers /onboarding (étape 2).
  useEffect(() => {
    if (state.success && state.redirectTo) {
      window.location.assign(state.redirectTo);
    }
  }, [state.success, state.redirectTo]);

  if (state.success) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-dark/[0.06] shadow-soft text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 border-2 border-green-700 flex items-center justify-center text-green-700 text-3xl">
          ✓
        </div>
        <h3 className="mt-5 font-serif text-[28px] text-green-900 leading-tight">
          Votre espace est créé.
        </h3>
        <p className="mt-3 text-[15px] text-dark/70">
          Redirection vers votre espace producteur…
        </p>
      </div>
    );
  }

  // Téléphone : grisé s'il est déjà connu du compte (connecté), sinon saisissable
  // (un consommateur peut ne pas avoir renseigné de téléphone).
  const phoneLocked = isLoggedIn && Boolean(loggedIn?.telephone);

  return (
    <form
      action={formAction}
      className="bg-white rounded-2xl p-6 md:p-10 border border-dark/[0.06] shadow-soft space-y-5"
    >
      {prefill ? (
        <input type="hidden" name="prefillToken" value={prefill.token} />
      ) : null}

      <div className="grid sm:grid-cols-2 gap-4">
        <Input
          label="Prénom"
          name="prenom"
          defaultValue={loggedIn?.prenom ?? prefill?.prenom ?? ""}
          readOnly={isLoggedIn && Boolean(loggedIn?.prenom)}
          autoComplete="given-name"
          required
        />
        <Input
          label="Nom"
          name="nom"
          defaultValue={loggedIn?.nom ?? prefill?.nom ?? ""}
          readOnly={isLoggedIn && Boolean(loggedIn?.nom)}
          autoComplete="family-name"
          required
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Input
          label="Email"
          type="email"
          name="email"
          defaultValue={loggedIn?.email ?? prefill?.email ?? ""}
          readOnly={isLoggedIn || Boolean(prefill)}
          hint={isLoggedIn ? "Lié à votre compte" : undefined}
          autoComplete="email"
          required
        />
        <Input
          label="Téléphone"
          type="tel"
          name="telephone"
          defaultValue={loggedIn?.telephone ?? prefill?.telephone ?? ""}
          readOnly={phoneLocked}
          autoComplete="tel"
          required
        />
      </div>

      {!isLoggedIn ? (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Mot de passe"
              type="password"
              name="password"
              autoComplete="new-password"
              required
            />
            <Input
              label="Confirmer le mot de passe"
              type="password"
              name="passwordConfirm"
              autoComplete="new-password"
              required
            />
          </div>
          <p className="text-[12px] text-dark/55 -mt-2">
            12 caractères minimum, avec au moins une majuscule, une minuscule et
            un chiffre.
          </p>
        </>
      ) : null}

      {/* Honeypot anti-bot : caché en CSS, jamais visible/typable par un humain. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />

      <label className="flex items-start gap-3 text-[13px] text-dark/75 leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          name="cgu_accepted"
          required
          className="mt-1 h-4 w-4 rounded border-dark/20 text-terra-700 focus:ring-terra-700/40"
        />
        <span>
          J&rsquo;accepte les{" "}
          <Link href="/cgu" className="text-terra-700 underline" target="_blank">
            conditions d&rsquo;utilisation
          </Link>{" "}
          et la création de mon compte producteur. Vos données restent
          confidentielles et ne sont jamais revendues.
        </span>
      </label>

      {state.error ? (
        <div className="rounded-lg bg-terra-50 border border-terra-200 px-4 py-3 text-[13px] text-terra-800">
          {state.error}
          {state.accountExists ? (
            <>
              {" "}
              <Link href="/connexion" className="font-semibold underline">
                Se connecter
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="pt-2">
        <Button type="submit" size="lg" className="w-full" disabled={isPending}>
          {isPending ? "Création…" : "Continuer →"}
        </Button>
      </div>
    </form>
  );
}

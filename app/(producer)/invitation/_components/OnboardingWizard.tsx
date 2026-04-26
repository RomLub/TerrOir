"use client";

import { useState } from "react";
import { Progress } from "./Progress";
import { StepCompteNew, StepCompteLogin } from "./StepCompte";
import { StepInfos } from "./StepInfos";

export type WizardCase = "new" | "consumer-login" | "consumer-loggedin";

export type WizardProps = {
  token: string;
  email: string;
  caseKind: WizardCase;
  startStep: 1 | 2;
  initialInfos: {
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
};

export function OnboardingWizard(props: WizardProps) {
  const [step, setStep] = useState<1 | 2>(props.startStep);
  // startStep mémorisé : si l'utilisateur a commencé à l'étape 2 (cas
  // consumer-loggedin), on ne doit pas lui permettre de "revenir" à l'étape 1.
  const [floorStep] = useState<1 | 2>(props.startStep);

  return (
    <div className="w-full max-w-xl rounded-2xl border border-terroir-border bg-white p-8 shadow-sm">
      <h1 className="font-serif text-2xl text-terroir-green-700">
        Bienvenue sur TerrOir
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        Création de votre profil producteur — {props.email}
      </p>

      <div className="mt-6">
        <Progress current={step} total={2} />
      </div>

      <div className="mt-6">
        {step === 1 ? (
          props.caseKind === "consumer-login" ? (
            <StepCompteLogin
              token={props.token}
              email={props.email}
              onSuccess={() => setStep(2)}
            />
          ) : (
            <StepCompteNew
              token={props.token}
              email={props.email}
              onSuccess={() => setStep(2)}
            />
          )
        ) : (
          <StepInfos
            token={props.token}
            initialValues={props.initialInfos}
            onBack={floorStep < 2 ? () => setStep(1) : undefined}
          />
        )}
      </div>
    </div>
  );
}

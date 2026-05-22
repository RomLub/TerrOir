// Chantier 3 Phase 3 — définitions des frises (funnel 6 étapes), distinctes
// selon la source du lead (prospecté vs spontané), cf. décision 0.5.
//
// Partagé client + serveur (pas de server-only) : consommé par les composants
// admin (frise, table, détail) et potentiellement les fetch SSR.
//
// La colonne DB `current_step` (smallint 1..6) porte l'étape ; la sémantique
// du numéro diffère entre les deux parcours, d'où deux jeux de libellés.

import type { LeadSource } from "./types";

export const PROSPECT_STEPS: readonly string[] = [
  "Repéré",
  "Rencontre",
  "Formulaire envoyé",
  "Formulaire complété",
  "Demande publication",
  "Publié",
];

export const SPONTANEOUS_STEPS: readonly string[] = [
  "Formulaire soumis",
  "Relance auto J+3",
  "Relance auto J+10",
  "Relance auto J+20",
  "Demande publication",
  "Publié",
];

// Prospecté = lead créé manuellement par l'admin (source 'invitation_directe').
// Spontané = lead issu du formulaire public (source 'formulaire_public').
export function isProspect(source: LeadSource): boolean {
  return source === "invitation_directe";
}

export function funnelSteps(source: LeadSource): readonly string[] {
  return isProspect(source) ? PROSPECT_STEPS : SPONTANEOUS_STEPS;
}

// Libellé de l'étape courante (1-indexé). Borne défensive si current_step hors
// [1..6] (ne devrait pas arriver — CHECK SQL).
export function stepLabel(source: LeadSource, step: number): string {
  const steps = funnelSteps(source);
  const idx = Math.min(Math.max(step, 1), steps.length) - 1;
  return steps[idx] ?? `Étape ${step}`;
}

export const FUNNEL_TOTAL_STEPS = 6;

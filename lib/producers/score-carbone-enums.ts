// Source unique des 3 indicateurs catégoriels du chantier T-200
// (score carbone & bien-être animal, fiche producteur publique).
// Importé par : Zod validator (onboarding), UI StepInfos, ScoreCarbonBlock
// (fiche publique), DistanceWidget. La migration SQL applique des CHECK
// constraints alignés sur ces mêmes valeurs.

export const MODE_ELEVAGE_VALUES = [
  "plein_air",
  "semi_plein_air",
  "batiment_ouvert",
  "batiment_ferme",
] as const;

export type ModeElevage = (typeof MODE_ELEVAGE_VALUES)[number];

export const MODE_ELEVAGE_LABELS: Record<ModeElevage, string> = {
  plein_air: "Plein air",
  semi_plein_air: "Semi-plein air",
  batiment_ouvert: "Bâtiment ouvert",
  batiment_ferme: "Bâtiment fermé",
};

export const MODE_ELEVAGE_HINTS: Record<ModeElevage, string> = {
  plein_air: "Animaux dehors la majeure partie de l'année",
  semi_plein_air: "Pâture saisonnière, parcours quotidien obligatoire",
  batiment_ouvert: "Bâtiment avec accès libre à un parcours extérieur",
  batiment_ferme: "Élevage en bâtiment toute l'année",
};

export const ALIMENTATION_VALUES = [
  "pature_dominante",
  "mixte",
  "aliments_achetes",
] as const;

export type Alimentation = (typeof ALIMENTATION_VALUES)[number];

export const ALIMENTATION_LABELS: Record<Alimentation, string> = {
  pature_dominante: "Pâture dominante",
  mixte: "Alimentation mixte",
  aliments_achetes: "Aliments achetés",
};

export const ALIMENTATION_HINTS: Record<Alimentation, string> = {
  pature_dominante:
    "Alimentation principalement issue de l'herbe et du fourrage de la ferme",
  mixte: "Pâture et fourrage de la ferme + complément d'aliments achetés",
  aliments_achetes:
    "Alimentation principalement à base d'aliments concentrés achetés",
};

export const DENSITE_ANIMALE_VALUES = [
  "extensive",
  "standard",
  "intensive",
] as const;

export type DensiteAnimale = (typeof DENSITE_ANIMALE_VALUES)[number];

export const DENSITE_ANIMALE_LABELS: Record<DensiteAnimale, string> = {
  extensive: "Extensive",
  standard: "Standard",
  intensive: "Intensive",
};

export const DENSITE_ANIMALE_HINTS: Record<DensiteAnimale, string> = {
  extensive: "Beaucoup d'espace par animal, faible chargement à l'hectare",
  standard: "Densité usuelle en élevage fermier",
  intensive: "Densité plus élevée, infrastructure d'élevage adaptée",
};

// Référence chiffrée pour le bloc "vs grande distribution" sur la fiche
// publique. Source : ADEME/FranceAgriMer (estimation circuit long viande
// importée). Le wording d'affichage doit toujours préciser "en moyenne" et
// "circuit long" pour rester factuel et non dénigrant.
export const GMS_DISTANCE_KM_REFERENCE = 1500;

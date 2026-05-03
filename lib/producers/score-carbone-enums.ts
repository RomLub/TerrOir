// Source unique des 3 indicateurs catégoriels du chantier T-200
// (score carbone & bien-être animal, fiche producteur publique).
// Importé par : Zod validator (onboarding), UI StepInfos, ScoreCarbonBlock
// (fiche publique), DistanceWidget. La migration SQL applique des CHECK
// constraints alignés sur ces mêmes valeurs — un test Vitest asserte la
// parité TS ↔ SQL pour bloquer toute dérive future.
//
// Convention des labels :
//   - LABELS = libellé technique précis, utilisé dans l'onboarding producteur
//     (le producteur maîtrise son vocabulaire métier).
//   - PUBLIC_LABELS = libellé grand public, utilisé sur la fiche consumer
//     (langage parlé, pas de jargon — décision comité review T-200 round 1).
//   - HINTS = phrase d'aide affichée sous le radio dans le formulaire
//     producteur ; sur la fiche publique consumer, ce même hint est rendu
//     en clair sous la pill (pas en tooltip natif `title`, qui se comporte
//     mal sur mobile — décision comité review T-200 round 2).

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

// Pour MODE_ELEVAGE, les libellés techniques sont déjà parlants au grand
// public — on les réutilise tels quels côté consumer. Le différenciant
// "ouvert vs fermé" pour les bâtiments est précisé via le HINT en tooltip.
export const MODE_ELEVAGE_PUBLIC_LABELS: Record<ModeElevage, string> =
  MODE_ELEVAGE_LABELS;

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

// Reformulation grand public des libellés alimentation : on évite
// "pâture dominante" / "alimentation mixte" (jargon agronomique) au profit
// de formulations parlées. Décision comité T-200 round 1.
export const ALIMENTATION_PUBLIC_LABELS: Record<Alimentation, string> = {
  pature_dominante: "Surtout à l'herbe",
  mixte: "Herbe + compléments",
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

// Reformulation grand public : "extensive/intensive" sont des termes
// techniques agronomiques. Décision comité T-200 round 1 — on garde la
// connotation visuelle (vert/ambre/orange) et on remplace le mot par sa
// traduction concrète.
export const DENSITE_ANIMALE_PUBLIC_LABELS: Record<DensiteAnimale, string> = {
  extensive: "Beaucoup d'espace",
  standard: "Espace standard",
  intensive: "Élevage dense",
};

export const DENSITE_ANIMALE_HINTS: Record<DensiteAnimale, string> = {
  extensive: "Beaucoup d'espace par animal, faible chargement à l'hectare",
  standard: "Densité usuelle en élevage fermier",
  intensive: "Densité plus élevée, infrastructure d'élevage adaptée",
};

// Référence chiffrée pour le bloc "vs grande distribution" sur la fiche
// publique. Estimation indicative non sourcée nominativement : ordre de
// grandeur de la distance moyenne parcourue par les produits alimentaires
// en circuit long (importation, transit centrale d'achat, livraison
// magasin). Le wording d'affichage doit toujours préciser "en moyenne"
// et "circuit long" pour rester factuel et non dénigrant.
//
// Décision comité review T-200 round 2 : on ne cite plus « ADEME » en
// nom propre tant qu'on n'a pas l'intitulé d'étude + année + lien — un
// nom d'institution nu est juridiquement fragile. À valider avec
// l'avocat T-003 avant ouverture publique : la review pourra soit
// substituer une source précise (étude datée, lien officiel), soit
// reformuler le chiffre lui-même.
export const GMS_DISTANCE_KM_REFERENCE = 1500;
export const GMS_DISTANCE_SOURCE_LABEL =
  "Estimation indicative — ordres de grandeur du transport en circuit long";

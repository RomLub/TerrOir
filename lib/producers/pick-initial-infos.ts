// Pré-remplissage de l'étape "infos producteur" du wizard onboarding (Phase 2
// du chantier "Vision funnel producteur"). Trois sources possibles, fusionnées
// par priorité décroissante :
//
//   1) `producer` — la fiche producers en draft : ce que l'utilisateur a déjà
//      saisi puis abandonné. C'est la source la plus fiable et la plus récente
//      pour les champs business (nom_exploitation, forme_juridique, etc.).
//   2) `user`     — la ligne users : prenom/nom/telephone enregistrés lors d'une
//      inscription consumer antérieure ou d'un step précédent (avant la fusion
//      en wizard 2 étapes, le StepPersonnel écrivait ici).
//   3) `lead`     — la ligne producer_interests matchée par email : l'info
//      saisie au formulaire public /devenir-producteur (statut 'contacted')
//      ou les champs renseignés par l'admin lors d'une invitation directe.
//
// La règle est "premier non-vide gagne" champ par champ. Une chaîne vide ou
// la sentinelle "À compléter" (placeholder posé par create-account.ts à la
// création du draft producer) sont considérées comme vides : on continue de
// chercher dans les sources suivantes.

export interface ProducerSource {
  nom_exploitation: string | null;
  forme_juridique: string | null;
  siret: string | null;
  adresse: string | null;
  code_postal: string | null;
  commune: string | null;
  type_production: string | null;
  type_production_precision: string | null;
}

export interface UserSource {
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
}

export interface LeadSource {
  prenom: string | null;
  nom: string | null;
  telephone: string | null;
  nom_exploitation: string | null;
  commune: string | null;
}

export interface InitialInfos {
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
}

const PLACEHOLDER = "À compléter";

function pick(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    if (c && c !== PLACEHOLDER) return c;
  }
  return "";
}

export function pickInitialInfos(
  producer: ProducerSource | null,
  user: UserSource | null,
  lead: LeadSource | null,
): InitialInfos {
  return {
    prenom: pick(user?.prenom, lead?.prenom),
    nom: pick(user?.nom, lead?.nom),
    telephone: pick(user?.telephone, lead?.telephone),
    // prenom_affichage : dérivé de users.prenom (source unique). Le wizard
    // continue d'écrire dans producers.prenom_affichage pour compat avec le
    // schéma DB courant (DROP COLUMN prévu chantier suivant), mais la lecture
    // ne remonte plus la colonne.
    prenom_affichage: pick(user?.prenom, lead?.prenom),
    nom_exploitation: pick(producer?.nom_exploitation, lead?.nom_exploitation),
    forme_juridique: pick(producer?.forme_juridique),
    siret: pick(producer?.siret),
    adresse: pick(producer?.adresse),
    code_postal: pick(producer?.code_postal),
    commune: pick(producer?.commune, lead?.commune),
    type_production: pick(producer?.type_production),
    type_production_precision: pick(producer?.type_production_precision),
  };
}

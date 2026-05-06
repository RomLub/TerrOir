// T-243 — Versioning historisé des valeurs d'enums score-carbone (DGCCRF).
//
// Pour chaque déclaration archivée par T-241 (snapshot des 3 enums
// `mode_elevage`, `alimentation`, `densite_animale`), on stamp la VERSION
// des valeurs d'enums présentes dans le système au moment de la coche. La
// raison est probatoire : si dans 18 mois on bumpe l'enum `mode_elevage`
// pour ajouter `silvopastoralisme`, ou si on raffine la définition de
// `pature_dominante`, un audit DGCCRF doit pouvoir reconstituer
// rétrospectivement :
//   1. quelles valeurs étaient possibles au moment de la déclaration ;
//   2. quelle définition (label public + hint pédagogique) était associée
//      à chaque valeur à ce moment-là.
//
// Pattern volontairement IDENTIQUE à T-241 (`DECLARATION_VERACITE_WORDINGS`)
// pour préserver l'invariant de méthode :
//   - map versionnée IMMUABLE (ne jamais modifier une entrée existante) ;
//   - bump = ajout d'une nouvelle version + nouvelle entrée + bump de
//     `SCORE_CARBONE_ENUMS_VERSION` ;
//   - migration SQL CHECK constraint qui whitelist les versions valides
//     (cf. T-292 pour le wording, T-243 pour les enums) ;
//   - stampage atomique dans la RPC `update_producer_onboarding`.
//
// CHAMP STAMPÉ vs CHAMP STAMPABLE :
//   - `declaration_indicateurs_wording_version` (T-241/T-292) = version du
//     TEXTE certifié vu par le producteur quand il a coché.
//   - `declaration_indicateurs_enums_version` (T-243) = version des
//     VALEURS et de leur définition métier au moment de la déclaration.
//
// Les deux peuvent évoluer indépendamment :
//   - bump wording sans bump enums : reformulation de la phrase certifiée.
//   - bump enums sans bump wording : ajout d'une valeur ou révision d'une
//     définition métier sans toucher à la phrase d'engagement globale.

export const SCORE_CARBONE_ENUMS_VERSION = "v1.0";

// Snapshot complet de la sémantique métier des 3 enums à une version
// donnée. Les valeurs (clés) restent ce qui est stocké en base
// (`producers.mode_elevage`, etc.) ; les labels et hints sont la
// définition publique à ce moment-là — c'est ce qui permet à un audit
// DGCCRF rétrospectif de répondre « qu'est-ce qu'un producteur cochant
// `pature_dominante` en mai 2026 affirmait précisément ? ».
//
// NE JAMAIS modifier ni supprimer une entrée existante. Pour faire
// évoluer un enum (ajout valeur, raffinage hint), AJOUTER une nouvelle
// version en bas de la map et bumper `SCORE_CARBONE_ENUMS_VERSION`.
// Les producteurs en v1.0 conservent leur trace probatoire intacte.
export type ScoreCarboneEnumsSnapshot = {
  mode_elevage: Record<string, { label: string; hint: string }>;
  alimentation: Record<string, { label: string; hint: string }>;
  densite_animale: Record<string, { label: string; hint: string }>;
};

export const SCORE_CARBONE_ENUMS_WORDINGS: Readonly<
  Record<string, ScoreCarboneEnumsSnapshot>
> = {
  "v1.0": {
    mode_elevage: {
      plein_air: {
        label: "Plein air",
        hint: "Animaux dehors la majeure partie de l'année",
      },
      semi_plein_air: {
        label: "Semi-plein air",
        hint: "Pâture saisonnière, parcours quotidien obligatoire",
      },
      batiment_ouvert: {
        label: "Bâtiment ouvert",
        hint: "Bâtiment avec accès libre à un parcours extérieur",
      },
      batiment_ferme: {
        label: "Bâtiment fermé",
        hint: "Élevage en bâtiment toute l'année",
      },
    },
    alimentation: {
      pature_dominante: {
        label: "Pâture dominante",
        hint: "Alimentation principalement issue de l'herbe et du fourrage de la ferme",
      },
      mixte: {
        label: "Alimentation mixte",
        hint: "Pâture et fourrage de la ferme + complément d'aliments achetés",
      },
      aliments_achetes: {
        label: "Aliments achetés",
        hint: "Alimentation principalement à base d'aliments concentrés achetés",
      },
    },
    densite_animale: {
      extensive: {
        label: "Extensive",
        hint: "Beaucoup d'espace par animal, faible chargement à l'hectare",
      },
      standard: {
        label: "Standard",
        hint: "Densité usuelle en élevage fermier",
      },
      intensive: {
        label: "Intensive",
        hint: "Densité plus élevée, infrastructure d'élevage adaptée",
      },
    },
  },
};

// Sans argument, retourne le snapshot de la version courante. Avec
// argument explicite, sert à reconstituer la sémantique historique d'une
// version archivée en base (`declaration_indicateurs_enums_version`)
// pour audit DGCCRF.
export function getScoreCarboneEnumsSnapshot(
  version: string = SCORE_CARBONE_ENUMS_VERSION,
): ScoreCarboneEnumsSnapshot | null {
  return SCORE_CARBONE_ENUMS_WORDINGS[version] ?? null;
}

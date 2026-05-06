// Versions CGU/CGV centralisées pour persistance DB lors de l'acceptation
// (inscription / checkout). Snapshot du contrat juridique en vigueur que
// l'utilisateur a réellement accepté.
//
// Convention de versioning :
//   - 1.x : modifications mineures (typo, reformulation, ajout d'exemple sans
//     impact sur les droits/obligations) → pas de réacceptation forcée.
//   - 2.x : modifications majeures (changement de droits/obligations, nouveau
//     traitement de données, modification des conditions de remboursement) →
//     prévoir un flow popup réacceptation au prochain login pour les users
//     dont users.cgu_version < version courante. Idem pour CGV au prochain
//     checkout côté order. Chantier dédié à implémenter quand le besoin se
//     présente (pas couvert par cette V1).
//
// Procédure mise à jour :
//   1. Modifier le contenu des pages /cgu ou /cgv.
//   2. Bumper la version ici (1.0 → 1.1 mineure / 2.0 majeure).
//   3. Pour majeur : prévoir le flow réacceptation avant déploiement.
//   4. Tests vitest passent (snapshot version).
export const LEGAL_VERSIONS = {
  CGU: "1.0",
  CGV: "1.0",
} as const;

export type LegalDocument = keyof typeof LEGAL_VERSIONS;

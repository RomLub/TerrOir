// T-241 — Persistance de la déclaration sur l'honneur producteur (DGCCRF).
//
// Le formulaire d'onboarding (StepInfos) affiche une case « Je certifie que
// les indicateurs déclarés correspondent à ma pratique réelle » obligatoire
// dès qu'au moins un des 3 enums score-carbone (mode_elevage, alimentation,
// densite_animale) est rempli. Avant T-241, cette case était validée Zod
// mais non archivée — pas de trace datée en cas de contrôle DGCCRF.
//
// Ce helper produit le payload des 3 colonnes à écrire sur `producers` :
//   - declaration_indicateurs_veracite_at  (timestamp now())
//   - declaration_indicateurs_snapshot     (JSON des 3 valeurs déclarées)
//   - declaration_indicateurs_wording_version  (version du libellé certifié)
//
// On ne (re)persiste QUE si :
//   1. Au moins un enum est rempli dans le payload soumis (sinon pas de
//      déclaration à archiver, cohérent avec le refine Zod).
//   2. La case a été cochée (defensive — Zod aurait déjà rejeté sinon).
//   3. Au moins un des 3 enums a effectivement changé par rapport à l'état
//      actuel en base. Une édition qui ne touche QUE des champs hors-enum
//      (nom de la ferme, adresse…) n'écrase pas le timestamp d'origine.

export const DECLARATION_VERACITE_WORDING_VERSION = "v1.0";

export type IndicateursSnapshot = {
  mode_elevage: string | null;
  alimentation: string | null;
  densite_animale: string | null;
};

export type DeclarationVeraciteUpdate = {
  declaration_indicateurs_veracite_at: string;
  declaration_indicateurs_snapshot: IndicateursSnapshot;
  declaration_indicateurs_wording_version: string;
};

export function computeDeclarationVeraciteUpdate(args: {
  current: IndicateursSnapshot;
  next: IndicateursSnapshot;
  declarationCochee: boolean;
}): DeclarationVeraciteUpdate | null {
  const { current, next, declarationCochee } = args;

  const anyNextSet = Boolean(
    next.mode_elevage || next.alimentation || next.densite_animale,
  );
  if (!anyNextSet) return null;

  if (!declarationCochee) return null;

  const changed =
    current.mode_elevage !== next.mode_elevage ||
    current.alimentation !== next.alimentation ||
    current.densite_animale !== next.densite_animale;
  if (!changed) return null;

  return {
    declaration_indicateurs_veracite_at: new Date().toISOString(),
    declaration_indicateurs_snapshot: next,
    declaration_indicateurs_wording_version:
      DECLARATION_VERACITE_WORDING_VERSION,
  };
}

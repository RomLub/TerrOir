// T-241 — Persistance de la déclaration sur l'honneur producteur (DGCCRF).
//
// Le formulaire d'onboarding (StepInfos) affiche une case « Je certifie que
// les indicateurs déclarés correspondent à ma pratique réelle » obligatoire
// dès qu'au moins un des 3 enums score-carbone (mode_elevage, alimentation,
// densite_animale) est rempli. Avant T-241, cette case était validée Zod
// mais non archivée — pas de trace datée en cas de contrôle DGCCRF.
//
// 3 colonnes archivent l'engagement sur la table `producers` :
//   - declaration_indicateurs_veracite_at  (timestamp de la coche/re-coche)
//   - declaration_indicateurs_snapshot     (JSON des 3 valeurs déclarées)
//   - declaration_indicateurs_wording_version  (version du libellé certifié)
//
// La décision de (re)persister est faite ATOMIQUEMENT côté SQL par la RPC
// `update_producer_onboarding` (cf. migration T-241), jamais en JS — ce qui
// élimine la fenêtre lecture/modification non atomique entre un SELECT JS et
// l'UPDATE final (double-clic, retry concurrent). La RPC compare le snapshot
// précédemment archivé aux 3 enums effectivement écrits dans la même
// transaction et ne touche les 3 colonnes que si :
//   1. la case est cochée (defensive — Zod aurait déjà rejeté sinon) ;
//   2. au moins un enum est non NULL après UPDATE ;
//   3. les enums effectifs diffèrent du snapshot précédent (ou pas de
//      snapshot précédent — première coche).
//
// Sémantique « le producteur vide ses 3 enums » (tous NULL après UPDATE) :
// décision figée → on PRÉSERVE le timestamp et le snapshot historiques.
// Justification probatoire : la case avait bien été cochée à T0 sur des
// valeurs réelles, l'absence de re-déclaration aujourd'hui n'invalide pas
// rétroactivement cet engagement passé. La RPC respecte cette règle via la
// condition (mode_elevage IS NOT NULL OR alimentation IS NOT NULL OR
// densite_animale IS NOT NULL) — sans elle, pas de re-écriture, donc pas
// d'écrasement non plus.
//
// Pour la valeur probatoire de la trace, le numéro de version stocké en base
// (ex. "v1.0") n'a de sens que si le TEXTE EXACT correspondant reste
// retrouvable des années après le bump v1.1, v1.2, etc. La map
// `DECLARATION_VERACITE_WORDINGS` ci-dessous archive donc l'historique des
// libellés en code source, indéfiniment — même quand la version courante
// évoluera, les anciennes entrées de la map restent en place pour permettre
// de reconstituer le texte que le producteur a effectivement vu et certifié.

export const DECLARATION_VERACITE_WORDING_VERSION = "v1.0";

// Historique des libellés certifiés. NE JAMAIS modifier ni supprimer une
// entrée existante : c'est la source de vérité du texte exact qu'un
// producteur a vu et coché à un moment donné. Pour faire évoluer le wording,
// AJOUTER une nouvelle entrée (ex. "v1.1": "...") et bumper
// `DECLARATION_VERACITE_WORDING_VERSION`. Les producteurs en v1.0 conservent
// leur trace probatoire intacte.
export const DECLARATION_VERACITE_WORDINGS: Readonly<Record<string, string>> = {
  "v1.0":
    "Je certifie que les indicateurs déclarés ci-dessus (mode d'élevage, alimentation, densité) correspondent à ma pratique réelle, et je m'engage à les mettre à jour si ça change.",
  // v1.1 — préparation du futur bump (BL-2). Pas encore affichée :
  // DECLARATION_VERACITE_WORDING_VERSION reste "v1.0" tant que le passage
  // n'est pas décidé (cf. T-282 gouvernance, T-288 UX re-coche, T-293 runbook).
  // Évolutions par rapport à v1.0 :
  //   - précision « densité animale » (alignement nomenclature enum
  //     `densite_animale` vs ancien raccourci « densité ») ;
  //   - ajout d'une phrase d'information loyale RGPD : le producteur sait
  //     explicitement, au moment de cocher, que sa déclaration est
  //     horodatée et conservée à des fins probatoires (cf. T-286).
  "v1.1":
    "Je certifie que les indicateurs déclarés ci-dessus (mode d'élevage, alimentation, densité animale) correspondent à ma pratique réelle, et je m'engage à les mettre à jour si ça change. Je comprends que cette déclaration est horodatée et conservée à des fins probatoires.",
};

export function getDeclarationVeraciteText(version: string): string | null {
  return DECLARATION_VERACITE_WORDINGS[version] ?? null;
}

export type IndicateursSnapshot = {
  mode_elevage: string | null;
  alimentation: string | null;
  densite_animale: string | null;
};

// =============================================================================
// MIROIR SQL — toute modif ici exige une modif identique dans
//   supabase/migrations/20260504100000_t241_declaration_veracite_persistance.sql
//   (bloc « v_persist := … » de la fonction update_producer_onboarding).
// La SOURCE DE VÉRITÉ runtime reste le SQL (atomique, immune aux races) :
// cette fonction sert UNIQUEMENT à (a) documenter la sémantique pour la
// lecture humaine et (b) couvrir la décision en tests unitaires Vitest, en
// l'absence d'infra de test d'intégration SQL dans le projet (cf. TODO T-296).
// Si tu modifies l'un des deux sans toucher l'autre, les tests JS resteront
// verts mais la prod ne reflètera plus ce qui est testé.
// =============================================================================
//
// Cas couverts :
//   - case non cochée → false (defensive, Zod aurait déjà rejeté).
//   - tous les enums effectifs NULL → false (le producteur a vidé ses
//     déclarations ; on conserve les colonnes historiques telles quelles).
//   - pas de snapshot précédent (première coche) → true.
//   - snapshot précédent identique aux enums effectifs → false (édition qui
//     ne touche pas aux indicateurs : nom de la ferme, adresse, etc.).
//   - au moins un enum effectif diffère du snapshot précédent → true
//     (re-coche datée à chaque changement réel d'indicateur).
export function shouldPersistDeclarationVeracite(args: {
  currentSnapshot: IndicateursSnapshot | null;
  effectiveSnapshot: IndicateursSnapshot;
  declarationCochee: boolean;
}): boolean {
  const { currentSnapshot, effectiveSnapshot, declarationCochee } = args;
  if (!declarationCochee) return false;

  const anyEffectiveSet = Boolean(
    effectiveSnapshot.mode_elevage ||
      effectiveSnapshot.alimentation ||
      effectiveSnapshot.densite_animale,
  );
  if (!anyEffectiveSet) return false;

  if (currentSnapshot === null) return true;
  return (
    currentSnapshot.mode_elevage !== effectiveSnapshot.mode_elevage ||
    currentSnapshot.alimentation !== effectiveSnapshot.alimentation ||
    currentSnapshot.densite_animale !== effectiveSnapshot.densite_animale
  );
}

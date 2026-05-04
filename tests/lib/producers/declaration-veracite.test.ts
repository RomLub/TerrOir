import { describe, it, expect } from "vitest";
import {
  DECLARATION_VERACITE_WORDING_VERSION,
  DECLARATION_VERACITE_WORDINGS,
  getDeclarationVeraciteText,
  shouldPersistDeclarationVeracite,
  type IndicateursSnapshot,
} from "@/lib/producers/declaration-veracite";

// --- Map version → texte certifié ----------------------------------------
// Le texte stocké en code source est la source de vérité probatoire DGCCRF :
// même quand la version courante évoluera (v1.1, v1.2…), les anciennes
// entrées DOIVENT rester en place pour permettre de reconstituer le libellé
// exact qu'un producteur a vu et coché à T0. Ces tests servent de garde-fou
// contractuel — toute édition destructive (suppression d'une entrée,
// modification d'un texte v1.0 existant) cassera la suite et bloquera la PR.

describe("DECLARATION_VERACITE_WORDINGS — registre versionné", () => {
  it("la version courante DECLARATION_VERACITE_WORDING_VERSION pointe vers une entrée présente dans la map", () => {
    expect(DECLARATION_VERACITE_WORDINGS[DECLARATION_VERACITE_WORDING_VERSION]).toBeTypeOf(
      "string",
    );
  });

  it("v1.0 contient le texte exact affiché dans StepInfos.tsx (preuve probatoire DGCCRF)", () => {
    // Le wording v1.0 doit rester strictement immutable même quand v1.1 sera
    // introduit — sinon la trace en base des producteurs certifiés en v1.0
    // perd tout sens probatoire (impossible de reconstituer ce qu'ils ont
    // certifié). Si ce test casse à cause d'une refonte UX du libellé, il
    // FAUT bumper la version (v1.1 = nouveau texte) et NE PAS toucher v1.0.
    expect(DECLARATION_VERACITE_WORDINGS["v1.0"]).toBe(
      "Je certifie que les indicateurs déclarés ci-dessus (mode d'élevage, alimentation, densité) correspondent à ma pratique réelle, et je m'engage à les mettre à jour si ça change.",
    );
  });

  // SNAPSHOT VOLONTAIRE — le wording v1.1 est figé exactement par cette
  // assertion (toBe sur la chaîne entière, pas un regex). Justification : un
  // libellé à valeur juridique n'a de sens probatoire que si chaque caractère
  // est verrouillé — ponctuation, accord de genre, parenthèses, casse. Une
  // assertion regex sur les éléments de fond (« densité animale »,
  // « horodatée », « probatoires ») laisserait passer une dérive silencieuse
  // sur le reste du texte et fragiliserait la trace côté DGCCRF. Politique :
  // tant que VERSION_COURANTE n'est pas passée à "v1.1", ce snapshot est
  // libre de bouger en parallèle d'un raffinement du wording (cf.
  // commentaire « modifications libres » au-dessus de l'entrée v1.1 dans le
  // helper). Une fois VERSION_COURANTE basculée à "v1.1", ce snapshot
  // devient immutable au même titre que celui de v1.0 et toute évolution
  // doit passer par un bump v1.2 (NE PAS éditer ce test, créer un nouveau).
  it("v1.1 contient le texte exact préparé pour le futur bump (BL-2)", () => {
    // v1.1 est archivée à l'avance pour anticiper le passage : ajustement
    // « densité » → « densité animale » (alignement nomenclature enum) et
    // information loyale RGPD que la coche est horodatée (cf. T-286).
    // Tant que DECLARATION_VERACITE_WORDING_VERSION reste à "v1.0", aucun
    // producteur ne voit ce texte ; il sert seulement de preuve probatoire
    // figée pour le jour où la version courante basculera.
    expect(DECLARATION_VERACITE_WORDINGS["v1.1"]).toBe(
      "Je certifie que les indicateurs déclarés ci-dessus (mode d'élevage, alimentation, densité animale) correspondent à ma pratique réelle, et je m'engage à les mettre à jour si ça change. Je comprends que cette déclaration est horodatée et conservée à des fins probatoires.",
    );
  });

  it("verrou anti-bump : VERSION_COURANTE reste v1.0 ET pointe vers une entrée valide de la map (cf. runbook T-293)", () => {
    // Verrou anti-bump accidentel — si ce test casse au moment d'un bump
    // effectif, NE PAS le supprimer ni le passer à "v1.1" en premier réflexe.
    // Suivre le runbook T-293 dans l'ordre : (a) archiver la nouvelle entrée
    // dans la map [déjà fait pour v1.1 par BL-2], (b) bumper VERSION_COURANTE,
    // (c) aligner StepInfos.tsx (utilise désormais le helper, donc no-op),
    // (d) appliquer la politique re-coche T-288. Une fois le bump validé,
    // mettre à jour la valeur attendue ci-dessous (et seulement ici).
    expect(
      DECLARATION_VERACITE_WORDING_VERSION,
      "Si ce test casse, suivre le runbook T-293 étapes (a)→(d) avant de déverrouiller la valeur attendue.",
    ).toBe("v1.0");
    // Cohérence multi-référentiel : la version courante doit toujours pointer
    // vers une entrée présente dans la map des wordings archivés. Sans ce
    // garde-fou, un bump vers une clé inexistante ferait crasher l'UI au
    // runtime (helper retourne null) sans qu'aucun test ne s'en aperçoive.
    expect(
      Object.keys(DECLARATION_VERACITE_WORDINGS),
      "VERSION_COURANTE doit toujours pointer vers une clé existante de DECLARATION_VERACITE_WORDINGS.",
    ).toContain(DECLARATION_VERACITE_WORDING_VERSION);
  });

  it("getDeclarationVeraciteText() sans argument retourne le texte de la version courante (contrat no-op runtime BL-2)", () => {
    // Promesse principale du chantier BL-2 : ajouter v1.1 dans la map ne
    // change RIEN à ce que voit le producteur. Le helper appelé sans argument
    // sert de point d'entrée unique pour l'UI (StepInfos.tsx) — il retourne
    // toujours le wording de VERSION_COURANTE, donc tant que cette dernière
    // reste à "v1.0", aucun changement visible côté producteur.
    expect(getDeclarationVeraciteText()).toBe(
      DECLARATION_VERACITE_WORDINGS["v1.0"],
    );
    expect(getDeclarationVeraciteText()).toBe(
      DECLARATION_VERACITE_WORDINGS[DECLARATION_VERACITE_WORDING_VERSION],
    );
  });

  it("getDeclarationVeraciteText(version connue) → texte exact ; version inconnue → null", () => {
    expect(getDeclarationVeraciteText("v1.0")).toBe(
      DECLARATION_VERACITE_WORDINGS["v1.0"],
    );
    expect(getDeclarationVeraciteText("v1.1")).toBe(
      DECLARATION_VERACITE_WORDINGS["v1.1"],
    );
    expect(getDeclarationVeraciteText("v9.99")).toBeNull();
    // Ne pas accepter une chaîne vide comme version valide.
    expect(getDeclarationVeraciteText("")).toBeNull();
  });
});

// --- Spec exécutable de la décision de re-persistance ---------------------
// Source de vérité runtime = la RPC SQL update_producer_onboarding (CASE
// WHEN atomique). Cette fonction TS est un miroir testable et lisible de
// cette même logique. Les 5 cas critiques couverts ici doivent rester en
// phase avec la migration T-241 — toute divergence (changement SQL non
// répliqué ici, ou inverse) doit être considérée comme un bug.

const FULL_SNAPSHOT: IndicateursSnapshot = {
  mode_elevage: "plein_air",
  alimentation: "pature_dominante",
  densite_animale: "extensive",
};

describe("shouldPersistDeclarationVeracite — spec miroir RPC SQL", () => {
  it("création (snapshot précédent null) + 3 enums + cochée → persiste (true)", () => {
    expect(
      shouldPersistDeclarationVeracite({
        currentSnapshot: null,
        effectiveSnapshot: FULL_SNAPSHOT,
        declarationCochee: true,
      }),
    ).toBe(true);
  });

  it("édition qui CHANGE un enum (snapshot précédent ≠ effective) + cochée → re-persiste (true)", () => {
    expect(
      shouldPersistDeclarationVeracite({
        currentSnapshot: FULL_SNAPSHOT,
        effectiveSnapshot: { ...FULL_SNAPSHOT, alimentation: "mixte" },
        declarationCochee: true,
      }),
    ).toBe(true);
  });

  it("édition INERTE (snapshot précédent identique aux enums effectifs) + cochée → ne persiste pas (false)", () => {
    // Le user a re-soumis le formulaire (case toujours cochée par défaut)
    // sans toucher aux indicateurs. La RPC ne doit pas écraser le timestamp
    // d'engagement d'origine — préservation de la trace probatoire.
    expect(
      shouldPersistDeclarationVeracite({
        currentSnapshot: FULL_SNAPSHOT,
        effectiveSnapshot: { ...FULL_SNAPSHOT },
        declarationCochee: true,
      }),
    ).toBe(false);
  });

  it("tous les enums effectifs NULL (producteur qui vide ses déclarations) → ne persiste pas (false), trace historique préservée", () => {
    // Cas figé par le comité T-241 round 2 : si le producteur revient et
    // remet ses 3 enums à NULL, on NE TOUCHE PAS aux 3 colonnes
    // declaration_indicateurs_*. Justification probatoire : la case avait
    // bien été cochée à T0 sur des valeurs réelles, l'absence de
    // re-déclaration aujourd'hui n'invalide pas cet engagement passé.
    const empty: IndicateursSnapshot = {
      mode_elevage: null,
      alimentation: null,
      densite_animale: null,
    };
    expect(
      shouldPersistDeclarationVeracite({
        currentSnapshot: FULL_SNAPSHOT,
        effectiveSnapshot: empty,
        declarationCochee: true,
      }),
    ).toBe(false);
    // Idem si pas de snapshot précédent et pas d'enum (cas dégénéré, refusé
    // amont par Zod mais defensive ici).
    expect(
      shouldPersistDeclarationVeracite({
        currentSnapshot: null,
        effectiveSnapshot: empty,
        declarationCochee: true,
      }),
    ).toBe(false);
  });

  it("case non cochée → ne persiste jamais (false), même avec enums et snapshot différent", () => {
    // Defensive : le refine Zod aurait déjà rejeté ce cas ; cette branche
    // garantit que la RPC ne touche pas aux 3 colonnes même si la case
    // arrivait pour une raison quelconque non cochée.
    expect(
      shouldPersistDeclarationVeracite({
        currentSnapshot: null,
        effectiveSnapshot: FULL_SNAPSHOT,
        declarationCochee: false,
      }),
    ).toBe(false);
    expect(
      shouldPersistDeclarationVeracite({
        currentSnapshot: FULL_SNAPSHOT,
        effectiveSnapshot: { ...FULL_SNAPSHOT, alimentation: "mixte" },
        declarationCochee: false,
      }),
    ).toBe(false);
  });

  it("changement partiel (un seul enum diffère) + cochée → re-persiste (true)", () => {
    expect(
      shouldPersistDeclarationVeracite({
        currentSnapshot: FULL_SNAPSHOT,
        effectiveSnapshot: { ...FULL_SNAPSHOT, mode_elevage: "batiment_ouvert" },
        declarationCochee: true,
      }),
    ).toBe(true);
  });
});

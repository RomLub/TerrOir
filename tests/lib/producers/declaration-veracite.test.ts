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

  it("getDeclarationVeraciteText(version connue) → texte exact ; version inconnue → null", () => {
    expect(getDeclarationVeraciteText("v1.0")).toBe(
      DECLARATION_VERACITE_WORDINGS["v1.0"],
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

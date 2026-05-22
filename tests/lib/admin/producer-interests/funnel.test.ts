import { describe, it, expect } from "vitest";
import {
  PROSPECT_STEPS,
  SPONTANEOUS_STEPS,
  isProspect,
  funnelSteps,
  stepLabel,
  FUNNEL_TOTAL_STEPS,
} from "@/lib/admin/producer-interests/funnel";

describe("funnel", () => {
  it("6 étapes par parcours", () => {
    expect(PROSPECT_STEPS).toHaveLength(FUNNEL_TOTAL_STEPS);
    expect(SPONTANEOUS_STEPS).toHaveLength(FUNNEL_TOTAL_STEPS);
  });

  it("isProspect : invitation_directe = prospect, formulaire_public = spontané", () => {
    expect(isProspect("invitation_directe")).toBe(true);
    expect(isProspect("formulaire_public")).toBe(false);
  });

  it("funnelSteps renvoie le bon jeu selon la source", () => {
    expect(funnelSteps("invitation_directe")).toBe(PROSPECT_STEPS);
    expect(funnelSteps("formulaire_public")).toBe(SPONTANEOUS_STEPS);
  });

  it("stepLabel : libellés distincts prospect vs spontané", () => {
    expect(stepLabel("invitation_directe", 1)).toBe("Repéré");
    expect(stepLabel("formulaire_public", 1)).toBe("Formulaire soumis");
    expect(stepLabel("invitation_directe", 3)).toBe("Formulaire envoyé");
    expect(stepLabel("formulaire_public", 3)).toBe("Relance auto J+10");
    expect(stepLabel("invitation_directe", 6)).toBe("Publié");
    expect(stepLabel("formulaire_public", 6)).toBe("Publié");
  });

  it("stepLabel borne les valeurs hors [1..6]", () => {
    expect(stepLabel("invitation_directe", 0)).toBe("Repéré");
    expect(stepLabel("invitation_directe", 99)).toBe("Publié");
  });
});

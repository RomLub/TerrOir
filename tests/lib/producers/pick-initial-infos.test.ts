import { describe, it, expect } from "vitest";
import {
  pickInitialInfos,
  type LeadSource,
  type ProducerSource,
  type UserSource,
} from "@/lib/producers/pick-initial-infos";

const fullProducer: ProducerSource = {
  nom_exploitation: "Ferme du Pré",
  forme_juridique: "gaec",
  siret: "12345678901234",
  adresse: "12 chemin du Bois",
  code_postal: "72000",
  commune: "Le Mans",
  type_production: "elevage",
  type_production_precision: null,
};

const fullUser: UserSource = {
  prenom: "Julien",
  nom: "Dupont",
  telephone: "0612345678",
};

const fullLead: LeadSource = {
  prenom: "Julien-Lead",
  nom: "DupontLead",
  telephone: "0698765432",
  nom_exploitation: "Ferme du Pré (lead)",
  commune: "Allonnes",
};

describe("pickInitialInfos", () => {
  it("returns all empty strings when every source is null", () => {
    const result = pickInitialInfos(null, null, null);
    expect(result).toEqual({
      prenom: "",
      nom: "",
      telephone: "",
      nom_exploitation: "",
      forme_juridique: "",
      siret: "",
      adresse: "",
      code_postal: "",
      commune: "",
      type_production: "",
      type_production_precision: "",
    });
  });

  it("prioritises user over lead for prenom/nom/telephone", () => {
    const result = pickInitialInfos(fullProducer, fullUser, fullLead);
    expect(result.prenom).toBe("Julien");
    expect(result.nom).toBe("Dupont");
    expect(result.telephone).toBe("0612345678");
  });

  it("falls back to lead when user fields are null", () => {
    const emptyUser: UserSource = { prenom: null, nom: null, telephone: null };
    const result = pickInitialInfos(null, emptyUser, fullLead);
    expect(result.prenom).toBe("Julien-Lead");
    expect(result.nom).toBe("DupontLead");
    expect(result.telephone).toBe("0698765432");
  });

  it("prioritises producer over lead for nom_exploitation and commune", () => {
    const result = pickInitialInfos(fullProducer, null, fullLead);
    expect(result.nom_exploitation).toBe("Ferme du Pré");
    expect(result.commune).toBe("Le Mans");
  });

  it("falls back to lead for nom_exploitation and commune when producer is null", () => {
    const result = pickInitialInfos(null, null, fullLead);
    expect(result.nom_exploitation).toBe("Ferme du Pré (lead)");
    expect(result.commune).toBe("Allonnes");
  });

  it("treats 'À compléter' placeholder as empty", () => {
    const placeholderProducer: ProducerSource = {
      ...fullProducer,
      nom_exploitation: "À compléter",
    };
    const placeholderUser: UserSource = {
      prenom: "À compléter",
      nom: "À compléter",
      telephone: "0612345678",
    };
    const result = pickInitialInfos(
      placeholderProducer,
      placeholderUser,
      fullLead,
    );
    expect(result.prenom).toBe("Julien-Lead");
    expect(result.nom_exploitation).toBe("Ferme du Pré (lead)");
  });

  it("treats empty strings as empty (continues to next source)", () => {
    const blankUser: UserSource = { prenom: "", nom: "", telephone: "" };
    const result = pickInitialInfos(null, blankUser, fullLead);
    expect(result.prenom).toBe("Julien-Lead");
    expect(result.nom).toBe("DupontLead");
    expect(result.telephone).toBe("0698765432");
  });

  it("returns producer-only fields (siret, forme_juridique, adresse, etc.) from producer source", () => {
    const result = pickInitialInfos(fullProducer, null, null);
    expect(result.siret).toBe("12345678901234");
    expect(result.forme_juridique).toBe("gaec");
    expect(result.adresse).toBe("12 chemin du Bois");
    expect(result.code_postal).toBe("72000");
    expect(result.type_production).toBe("elevage");
  });

  it("leaves producer-only fields empty when producer is null (no lead fallback)", () => {
    const result = pickInitialInfos(null, fullUser, fullLead);
    expect(result.siret).toBe("");
    expect(result.forme_juridique).toBe("");
    expect(result.adresse).toBe("");
    expect(result.code_postal).toBe("");
    expect(result.type_production).toBe("");
  });

  it("normalises null type_production_precision to empty string", () => {
    const result = pickInitialInfos(fullProducer, null, null);
    expect(result.type_production_precision).toBe("");
  });

});

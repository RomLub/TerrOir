import { describe, it, expect } from "vitest";
import {
  escapeCsvField,
  escapeCsvFormula,
  serializeRowsToCsv,
  maskEmailForExport,
} from "@/lib/exports/csv";

describe("escapeCsvFormula (F-023 CSV injection)", () => {
  it("préfixe apostrophe sur '=cmd' (formule)", () => {
    expect(escapeCsvFormula("=cmd")).toBe("'=cmd");
  });

  it("préfixe apostrophe sur '=SUM(A1:A10)' (formule complexe)", () => {
    expect(escapeCsvFormula("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
  });

  it("préfixe apostrophe sur '+avg' (formule + prefix)", () => {
    expect(escapeCsvFormula("+avg")).toBe("'+avg");
  });

  it("préfixe apostrophe sur '-1' (formule - prefix)", () => {
    expect(escapeCsvFormula("-1")).toBe("'-1");
  });

  it("préfixe apostrophe sur '@SUM(1)' (@ prefix)", () => {
    expect(escapeCsvFormula("@SUM(1)")).toBe("'@SUM(1)");
  });

  it("préfixe apostrophe sur tab leading (\\t)", () => {
    expect(escapeCsvFormula("\tinjected")).toBe("'\tinjected");
  });

  it("préfixe apostrophe sur CR leading (\\r)", () => {
    expect(escapeCsvFormula("\rinjected")).toBe("'\rinjected");
  });

  it("ne modifie pas une valeur normale", () => {
    expect(escapeCsvFormula("Acme Foo")).toBe("Acme Foo");
  });

  it("ne modifie pas une valeur vide", () => {
    expect(escapeCsvFormula("")).toBe("");
  });

  it("ne modifie pas une valeur avec '=' au milieu", () => {
    expect(escapeCsvFormula("nom=valeur")).toBe("nom=valeur");
  });
});

describe("escapeCsvField avec formula injection", () => {
  it("préfixe apostrophe puis quote si la formule contient virgule", () => {
    // "=cmd,foo" → préfixe '=cmd,foo → contient ',' → quoting RFC 4180
    expect(escapeCsvField("=cmd,foo")).toBe(`"'=cmd,foo"`);
  });

  it("préfixe apostrophe sans quoting si pas de caractère spécial", () => {
    expect(escapeCsvField("=cmd")).toBe("'=cmd");
  });

  it("retourne null/undefined comme chaîne vide (pas d'apostrophe)", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("ne traite pas un nombre négatif String(-1) comme inoffensif (préfix apostrophe)", () => {
    // String(-1) === "-1" qui commence par "-" → apostrophe ajouté.
    // Acceptable : le destinataire voit "-1" dans Excel, l'apostrophe
    // est invisible mais conservée à la copie. Trade-off documenté.
    expect(escapeCsvField(-1)).toBe("'-1");
  });
});

describe("escapeCsvField", () => {
  it("retourne null/undefined comme chaîne vide", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("ne quote pas une valeur sans caractère spécial", () => {
    expect(escapeCsvField("abc")).toBe("abc");
    expect(escapeCsvField(42)).toBe("42");
  });

  it("quote et double les guillemets internes (RFC 4180)", () => {
    expect(escapeCsvField('a"b')).toBe('"a""b"');
  });

  it("quote la virgule (séparateur)", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("quote les retours ligne", () => {
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
    expect(escapeCsvField("a\rb")).toBe('"a\rb"');
  });
});

describe("serializeRowsToCsv", () => {
  it("préfixe BOM UTF-8 + header CRLF + lignes CRLF", () => {
    const csv = serializeRowsToCsv(
      [
        { a: "x", b: 1 },
        { a: "y", b: 2 },
      ],
      [
        { key: "a", header: "col_a" },
        { key: "b", header: "col_b" },
      ],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    // BOM + header + CRLF + row1 + CRLF + row2 + CRLF (terminator)
    expect(csv).toBe("﻿col_a,col_b\r\nx,1\r\ny,2\r\n");
  });

  it("échappe les caractères spéciaux dans les colonnes", () => {
    const csv = serializeRowsToCsv(
      [{ name: "Acme, Inc.", note: 'with "quotes"' }],
      [
        { key: "name", header: "name" },
        { key: "note", header: "note" },
      ],
    );
    expect(csv).toContain('"Acme, Inc."');
    expect(csv).toContain('"with ""quotes"""');
  });

  it("supporte 0 lignes (header seul)", () => {
    const csv = serializeRowsToCsv([] as { a: string }[], [
      { key: "a", header: "col_a" },
    ]);
    expect(csv).toBe("﻿col_a\r\n");
  });
});

describe("maskEmailForExport", () => {
  it("retourne chaîne vide pour email NULL/undefined", () => {
    expect(maskEmailForExport(null)).toBe("");
    expect(maskEmailForExport(undefined)).toBe("");
  });

  it("masque la part locale (1er char) et le domaine (1er char + TLD)", () => {
    expect(maskEmailForExport("julien@example.fr")).toBe("j***@e***.fr");
    expect(maskEmailForExport("a@b.com")).toBe("a***@b***.com");
  });

  it("préserve le TLD multi-caractère (.com, .org, .co.uk treated as .uk)", () => {
    expect(maskEmailForExport("user@domain.org")).toBe("u***@d***.org");
    // .co.uk : on garde uniquement le dernier .uk (limitation acceptée)
    expect(maskEmailForExport("user@example.co.uk")).toBe("u***@e***.uk");
  });

  it("gère un email sans @ comme invalide", () => {
    expect(maskEmailForExport("not-an-email")).toBe("***");
  });
});

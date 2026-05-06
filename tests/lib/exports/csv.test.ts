import { describe, it, expect } from "vitest";
import {
  escapeCsvField,
  serializeRowsToCsv,
  maskEmailForExport,
} from "@/lib/exports/csv";

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

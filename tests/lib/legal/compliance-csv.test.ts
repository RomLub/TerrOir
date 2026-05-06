import { describe, it, expect } from "vitest";
import {
  escapeCsvField,
  serializeComplianceUsersToCsv,
} from "@/lib/legal/compliance-csv";
import type { UserComplianceRow } from "@/lib/legal/compliance";

const BOM = "﻿";
const HEADER =
  "user_id;email;prenom;nom;created_at;cgu_status;cgu_accepted_at;cgu_version";

function rowFixture(overrides: Partial<UserComplianceRow> = {}): UserComplianceRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    prenom: "Romain",
    nom: "Lubin",
    createdAt: "2026-04-30T14:32:01.000Z",
    status: "accepted_current",
    acceptedAt: "2026-04-30T14:32:01.000Z",
    acceptedVersion: "1.0",
    daysSinceAcceptance: 6,
    ...overrides,
  };
}

describe("escapeCsvField (compliance-csv)", () => {
  it("préserve les valeurs simples", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField("")).toBe("");
  });

  it("enveloppe sur ';', '\"', '\\n', '\\r'", () => {
    expect(escapeCsvField("a;b")).toBe('"a;b"');
    expect(escapeCsvField('a"b')).toBe('"a""b"');
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
  });
});

describe("serializeComplianceUsersToCsv", () => {
  it("préfixe le BOM UTF-8 + ligne d'en-tête", () => {
    const csv = serializeComplianceUsersToCsv([]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(BOM + HEADER + "\r\n");
  });

  it("sérialise une row simple correctement", () => {
    const csv = serializeComplianceUsersToCsv([rowFixture()]);
    const lines = csv.slice(BOM.length).split("\r\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      "11111111-1111-4111-8111-111111111111;user@example.com;Romain;Lubin;2026-04-30T14:32:01.000Z;accepted_current;2026-04-30T14:32:01.000Z;1.0",
    );
  });

  it("sérialise les valeurs nulles en string vide", () => {
    const csv = serializeComplianceUsersToCsv([
      rowFixture({
        prenom: null,
        nom: null,
        status: "never_accepted",
        acceptedAt: null,
        acceptedVersion: null,
        daysSinceAcceptance: null,
      }),
    ]);
    const data = csv.slice(BOM.length).split("\r\n")[1];
    expect(data).toBe(
      "11111111-1111-4111-8111-111111111111;user@example.com;;;2026-04-30T14:32:01.000Z;never_accepted;;",
    );
  });

  it("échappe un email contenant ';'", () => {
    const csv = serializeComplianceUsersToCsv([
      rowFixture({ email: "weird;email@example.com" }),
    ]);
    expect(csv).toContain('"weird;email@example.com"');
  });
});

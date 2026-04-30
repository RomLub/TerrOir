import { describe, it, expect } from "vitest";

import {
  escapeCsvField,
  serializeAuditLogsToCsv,
  type AuditLogCsvRow,
} from "@/lib/audit-logs/serialize-csv";

const BOM = "﻿";
const HEADER =
  "created_at;event_type;user_id;ip_address;user_agent;metadata;is_producer";

function rowFixture(overrides: Partial<AuditLogCsvRow> = {}): AuditLogCsvRow {
  return {
    created_at: "2026-04-30T14:32:01.000Z",
    event_type: "account_login_password",
    user_id: "11111111-2222-3333-4444-555555555555",
    ip_address: "1.2.3.4",
    user_agent: "Mozilla/5.0",
    metadata: {},
    is_producer: false,
    ...overrides,
  };
}

describe("escapeCsvField", () => {
  it("renvoie la valeur telle quelle si pas de caractère spécial", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField("a-b-c_123")).toBe("a-b-c_123");
    expect(escapeCsvField("")).toBe("");
  });

  it("enveloppe et échappe les guillemets internes", () => {
    expect(escapeCsvField('a"b')).toBe('"a""b"');
    expect(escapeCsvField('"')).toBe('""""');
  });

  it("enveloppe quand la valeur contient le séparateur ';'", () => {
    expect(escapeCsvField("a;b")).toBe('"a;b"');
  });

  it("enveloppe quand la valeur contient '\\n' ou '\\r'", () => {
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
    expect(escapeCsvField("a\rb")).toBe('"a\rb"');
    expect(escapeCsvField("a\r\nb")).toBe('"a\r\nb"');
  });

  it("ne touche PAS les virgules (séparateur RFC est ';' ici)", () => {
    expect(escapeCsvField("a,b")).toBe("a,b");
  });
});

describe("serializeAuditLogsToCsv", () => {
  it("préfixe le BOM UTF-8 et la ligne d'en-tête", () => {
    const csv = serializeAuditLogsToCsv([]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(BOM + HEADER + "\r\n");
  });

  it("sérialise une row simple correctement", () => {
    const csv = serializeAuditLogsToCsv([
      rowFixture({
        metadata: { foo: "bar", n: 42 },
        is_producer: true,
      }),
    ]);
    const lines = csv.slice(BOM.length).split("\r\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      `2026-04-30T14:32:01.000Z;account_login_password;11111111-2222-3333-4444-555555555555;1.2.3.4;Mozilla/5.0;"{""foo"":""bar"",""n"":42}";true`,
    );
    expect(lines[2]).toBe(""); // trailing \r\n
  });

  it("sérialise les valeurs nulles en string vide", () => {
    const csv = serializeAuditLogsToCsv([
      rowFixture({
        user_id: null,
        ip_address: null,
        user_agent: null,
      }),
    ]);
    const data = csv.slice(BOM.length).split("\r\n")[1];
    expect(data).toBe(
      "2026-04-30T14:32:01.000Z;account_login_password;;;;{};false",
    );
  });

  it("échappe correctement un user_agent contenant ; et \"", () => {
    const csv = serializeAuditLogsToCsv([
      rowFixture({
        user_agent: 'Mozilla/5.0 (Linux; "Android")',
      }),
    ]);
    const data = csv.slice(BOM.length).split("\r\n")[1];
    expect(data).toContain('"Mozilla/5.0 (Linux; ""Android"")"');
  });

  it("sérialise metadata avec quotes imbriqués (JSON.stringify échappe \\n en \\\\n texte, donc pas de vrai retour ligne)", () => {
    const csv = serializeAuditLogsToCsv([
      rowFixture({
        metadata: { reason: 'user said\n"hello"', code: 42 },
      }),
    ]);
    // Le cell est wrappée et chaque " interne est doublé. Le \n d'origine
    // (vrai newline) est encodé par JSON.stringify en deux chars \ + n,
    // donc pas de retour ligne réel dans la cellule.
    expect(csv).toContain(
      '"{""reason"":""user said\\n\\""hello\\""""',
    );
    expect(csv).toContain("42");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("injecte une ligne d'avertissement en row 1 quand truncated=true", () => {
    const csv = serializeAuditLogsToCsv([rowFixture()], { truncated: true });
    const lines = csv.slice(BOM.length).split("\r\n");
    expect(lines[0]).toContain("AVERTISSEMENT");
    expect(lines[0]).toContain("10 000");
    expect(lines[1]).toBe(HEADER);
  });

  it("n'injecte rien quand truncated=false / undefined", () => {
    const csvFalse = serializeAuditLogsToCsv([rowFixture()], { truncated: false });
    const csvDefault = serializeAuditLogsToCsv([rowFixture()]);
    expect(csvFalse.slice(BOM.length).split("\r\n")[0]).toBe(HEADER);
    expect(csvDefault.slice(BOM.length).split("\r\n")[0]).toBe(HEADER);
  });

  it("traite metadata=null comme {} (tolérance)", () => {
    const csv = serializeAuditLogsToCsv([
      rowFixture({ metadata: null as unknown as Record<string, unknown> }),
    ]);
    const data = csv.slice(BOM.length).split("\r\n")[1];
    expect(data.endsWith(";{};false")).toBe(true);
  });
});

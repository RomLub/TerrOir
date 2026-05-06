import { describe, it, expect } from "vitest";

import { parseSearchParams } from "@/app/(admin)/audit-logs/_lib/parse-search-params";

describe("parseSearchParams", () => {
  it("retourne des filtres vides quand aucun searchParam n'est fourni", () => {
    const r = parseSearchParams({});
    expect(r.eventTypes).toEqual([]);
    expect(r.userId).toBeNull();
    expect(r.email).toBeNull();
    expect(r.dateFrom).toBeNull();
    expect(r.dateTo).toBeNull();
    expect(r.cursor).toBeNull();
  });

  it("accepte un email non vide trim", () => {
    expect(parseSearchParams({ email: "  Bob@example.fr  " }).email).toBe(
      "Bob@example.fr",
    );
  });

  it("ignore un email vide ou trop long (> 320 chars)", () => {
    expect(parseSearchParams({ email: "" }).email).toBeNull();
    expect(parseSearchParams({ email: "   " }).email).toBeNull();
    const huge = "a".repeat(320) + "@b.fr"; // 325 chars > 320 cap
    expect(parseSearchParams({ email: huge }).email).toBeNull();
  });

  it("ignore un email passé en string[] (Next.js fallthrough)", () => {
    expect(
      parseSearchParams({ email: ["a@b.fr", "c@d.fr"] }).email,
    ).toBeNull();
  });

  it("garde les event_types valides et drop ceux inconnus", () => {
    const r = parseSearchParams({
      event_type: ["account_logout", "totalement_inconnu", "stripe_dispute"],
    });
    expect(r.eventTypes).toEqual(["account_logout", "stripe_dispute"]);
  });

  it("dédupe les event_types répétés en gardant l'ordre de 1re occurrence", () => {
    const r = parseSearchParams({
      event_type: ["stripe_dispute", "account_logout", "stripe_dispute"],
    });
    expect(r.eventTypes).toEqual(["stripe_dispute", "account_logout"]);
  });

  it("convertit un event_type unique (string) en tableau d'une entrée", () => {
    const r = parseSearchParams({ event_type: "order_created" });
    expect(r.eventTypes).toEqual(["order_created"]);
  });

  it("ignore un user_id mal formé", () => {
    expect(parseSearchParams({ user_id: "abc" }).userId).toBeNull();
    expect(parseSearchParams({ user_id: "" }).userId).toBeNull();
    expect(
      parseSearchParams({ user_id: "00000000-0000-0000-0000" }).userId,
    ).toBeNull();
  });

  it("accepte un user_id UUID valide (mixed case)", () => {
    const valid = "AbCdEf01-2345-6789-abcd-ef0123456789";
    expect(parseSearchParams({ user_id: valid }).userId).toBe(valid);
  });

  it("ignore les dates au mauvais format", () => {
    expect(parseSearchParams({ date_from: "30/04/2026" }).dateFrom).toBeNull();
    expect(parseSearchParams({ date_to: "2026-4-30" }).dateTo).toBeNull();
  });

  it("accepte les dates au format YYYY-MM-DD", () => {
    const r = parseSearchParams({
      date_from: "2026-04-01",
      date_to: "2026-04-30",
    });
    expect(r.dateFrom).toBe("2026-04-01");
    expect(r.dateTo).toBe("2026-04-30");
  });

  it("transmet le cursor brut tel quel", () => {
    const r = parseSearchParams({ after: "eyJjcmVhdGVkQXQiOiIifQ" });
    expect(r.cursor).toBe("eyJjcmVhdGVkQXQiOiIifQ");
  });

  it("ignore les valeurs non-string (string[]) pour user_id et dates", () => {
    const r = parseSearchParams({
      user_id: ["a", "b"],
      date_from: ["2026-04-01"],
    });
    expect(r.userId).toBeNull();
    expect(r.dateFrom).toBeNull();
  });
});

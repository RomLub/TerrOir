import { describe, it, expect } from "vitest";

import { generateOtp, isValidOtpFormat } from "@/lib/email-change/otp";

describe("generateOtp", () => {
  it("retourne une chaîne de 6 chiffres", () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
    expect(otp).toHaveLength(6);
  });

  it("préserve les leading zeros (sample 1000)", () => {
    // P(au moins un leading 0 sur 1000 codes) = 1 - (0.9)^1000 ≈ 1.0.
    // On s'attend à ~100 codes commençant par 0 (uniform sur 0-9).
    let withLeadingZero = 0;
    for (let i = 0; i < 1000; i++) {
      if (generateOtp().startsWith("0")) withLeadingZero++;
    }
    expect(withLeadingZero).toBeGreaterThan(0);
  });

  it("distribution sanity : 1000 samples couvrent les 10 premiers chiffres", () => {
    const firstDigits = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      firstDigits.add(generateOtp()[0]!);
    }
    // P(un digit absent sur 1000) = (9/10)^1000 ≈ 1.7e-46. Quasi-certain.
    expect(firstDigits.size).toBe(10);
  });

  it("entropie minimale : 100 samples → 100 codes uniques (anti-collision)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateOtp());
    }
    // 100 samples sur 10^6 codes possibles : P(collision) ≈ C(100,2)/10^6
    // ≈ 0.5%. Très peu probable mais possible — on relaxe à >= 99 si besoin.
    // Acceptable de revoir à la baisse en cas de flake CI.
    expect(codes.size).toBe(100);
  });
});

describe("isValidOtpFormat", () => {
  it.each([["123456"], ["000000"], ["999999"], ["012345"]])(
    "valid: %s",
    (input) => {
      expect(isValidOtpFormat(input)).toBe(true);
    },
  );

  it.each([
    ["", "chaîne vide"],
    ["12345", "5 chiffres"],
    ["1234567", "7 chiffres"],
    ["12345a", "1 alpha en fin"],
    ["abcdef", "tous alpha"],
    ["12 456", "contient espace"],
    ["12-456", "contient tiret"],
    ["１２３４５６", "full-width unicode digits"],
    ["123.45", "contient point"],
    ["+12345", "contient plus"],
  ])("invalid: %s (%s)", (input) => {
    expect(isValidOtpFormat(input)).toBe(false);
  });
});

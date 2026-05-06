// Smoke tests pour le template email-change-otp-new (T-013 PR2).
// Pattern aligné stock-alert-confirm.test.tsx.

import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

import { render } from "@react-email/render";
import EmailChangeOtpNew, {
  subject,
} from "@/lib/resend/templates/email-change-otp-new";

const PROPS = {
  otpCode: "987654",
};

describe("EmailChangeOtpNew — subject", () => {
  it("subject FR fixe (pas dépendant des props)", () => {
    expect(subject(PROPS)).toBe(
      "TerrOir — confirme ta nouvelle adresse email",
    );
  });
});

describe("EmailChangeOtpNew — render HTML", () => {
  it("inclut le code OTP en gros dans le corps", async () => {
    const html = await render(<EmailChangeOtpNew {...PROPS} />);
    expect(html).toContain("987654");
  });

  it("mentionne l'expiration 10 minutes", async () => {
    const html = await render(<EmailChangeOtpNew {...PROPS} />);
    expect(html).toContain("10 minutes");
  });

  it("inclut un disclaimer si l'user n'est pas à l'origine", async () => {
    const html = await render(<EmailChangeOtpNew {...PROPS} />);
    expect(html).toContain("ignore cet");
  });

  it("ne révèle PAS l'ancienne adresse (asymétrie vs otp-current)", async () => {
    const html = await render(<EmailChangeOtpNew {...PROPS} />);
    // L'user à la nouvelle adresse n'a pas besoin de l'ancienne pour décider.
    // Cette absence est volontaire (cf. doc template).
    expect(html).not.toContain("@");
    // Vérifier qu'il n'y a pas trace explicite "old" / "ancien" pointant
    // vers une adresse spécifique.
  });
});

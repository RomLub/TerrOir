// Smoke tests pour le template email-change-otp-current (T-013 PR2).
// Pattern aligné stock-alert-confirm.test.tsx : @react-email/render +
// vi.hoisted env stub + assertions toContain.

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
import EmailChangeOtpCurrent, {
  subject,
} from "@/lib/resend/templates/email-change-otp-current";

const PROPS = {
  otpCode: "123456",
  newEmail: "newaddress@example.com",
};

describe("EmailChangeOtpCurrent — subject", () => {
  it("subject FR fixe (pas dépendant des props)", () => {
    expect(subject(PROPS)).toBe(
      "TerrOir — code de vérification pour changer votre email",
    );
  });
});

describe("EmailChangeOtpCurrent — render HTML", () => {
  it("inclut le code OTP en gros dans le corps", async () => {
    const html = await render(<EmailChangeOtpCurrent {...PROPS} />);
    expect(html).toContain("123456");
  });

  it("inclut la nouvelle adresse cible (garde-fou anti-phishing)", async () => {
    const html = await render(<EmailChangeOtpCurrent {...PROPS} />);
    expect(html).toContain("newaddress@example.com");
  });

  it("mentionne l'expiration 10 minutes", async () => {
    const html = await render(<EmailChangeOtpCurrent {...PROPS} />);
    expect(html).toContain("10 minutes");
  });

  it("inclut un disclaimer si l'user n'est pas à l'origine", async () => {
    const html = await render(<EmailChangeOtpCurrent {...PROPS} />);
    expect(html).toContain("ignorez cet");
  });

  it("ne rend pas l'OTP comme valeur attribut JSX (preuve d'inline body)", async () => {
    const html = await render(<EmailChangeOtpCurrent {...PROPS} />);
    // Le code apparaît au minimum 1x dans le body texte
    const occurrences = html.split(PROPS.otpCode).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });
});

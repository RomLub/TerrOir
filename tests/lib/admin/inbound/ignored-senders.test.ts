import { describe, it, expect } from "vitest";
import { isIgnoredSender } from "@/lib/admin/inbound/ignored-senders";

// Tests du pré-filtre bruit (chantier 9) : la boîte admin@ mélange mails utiles
// + bruit infra/bounces/outbound.

describe("isIgnoredSender", () => {
  it("ignore les domaines infra (+ sous-domaines)", () => {
    for (const e of [
      "notifications@stripe.com",
      "bounces.notifications@notifications.stripe.com",
      "noreply@resend.dev",
      "noreply@vercel.com",
      "no-reply@github.com",
      "alerts@notifications.github.com",
      "admin@ovh.net",
    ]) {
      expect(isIgnoredSender(e), e).toBe(true);
    }
  });

  it("ignore son propre domaine (outbound TerrOir)", () => {
    expect(isIgnoredSender("no-reply@terroir-local.fr")).toBe(true);
    expect(isIgnoredSender("contact@terroir-local.fr")).toBe(true);
  });

  it("ignore les bounces (mailer-daemon / postmaster)", () => {
    expect(isIgnoredSender("mailer-daemon@anything.com")).toBe(true);
    expect(isIgnoredSender("postmaster@x.fr")).toBe(true);
  });

  it("ignore une adresse malformée", () => {
    expect(isIgnoredSender("pasdemail")).toBe(true);
  });

  it("NE PAS ignorer un vrai expéditeur (producteur / consommateur / public)", () => {
    for (const e of ["jean@gmail.com", "ferme.dupont@orange.fr", "client@yahoo.fr"]) {
      expect(isIgnoredSender(e), e).toBe(false);
    }
  });
});

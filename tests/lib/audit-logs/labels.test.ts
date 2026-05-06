import { describe, it, expect } from "vitest";
import { ALL_EVENT_TYPES } from "@/app/(admin)/audit-logs/_lib/event-types";
import {
  AUDIT_EVENT_LABELS,
  getEventLabel,
} from "@/lib/audit-logs/labels";

describe("getEventLabel", () => {
  it("retourne le libellé FR mappé pour un event_type connu", () => {
    expect(getEventLabel("account_login_password")).toBe(
      "Connexion (mot de passe)",
    );
    expect(getEventLabel("admin_invite_sent")).toBe("Invitation envoyée");
    expect(getEventLabel("order_payment_succeeded")).toBe("Paiement réussi");
    expect(getEventLabel("admin_legal_compliance_exported")).toBe(
      "Export conformité CGU",
    );
  });

  it("fallback sur l'event_type brut si pas de mapping", () => {
    expect(getEventLabel("totalement_inconnu_xxx")).toBe(
      "totalement_inconnu_xxx",
    );
  });
});

describe("AUDIT_EVENT_LABELS — parité ALL_EVENT_TYPES", () => {
  it("chaque event_type déclaré dans ALL_EVENT_TYPES a un libellé FR explicite", () => {
    const missing: string[] = [];
    for (const t of ALL_EVENT_TYPES) {
      if (!AUDIT_EVENT_LABELS[t]) missing.push(t);
    }
    expect(
      missing,
      `event_types sans libellé FR : ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("aucun libellé n'est vide ou identique à l'event_type technique", () => {
    for (const [eventType, label] of Object.entries(AUDIT_EVENT_LABELS)) {
      expect(label.length, `libellé vide pour ${eventType}`).toBeGreaterThan(
        0,
      );
      expect(
        label,
        `libellé identique à event_type pour ${eventType} — pas une vraie traduction FR`,
      ).not.toBe(eventType);
    }
  });
});

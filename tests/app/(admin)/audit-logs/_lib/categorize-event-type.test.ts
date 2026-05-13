import { describe, it, expect } from "vitest";

import {
  categorizeEventType,
  CATEGORY_PALETTE,
} from "@/app/(admin)/audit-logs/_lib/categorize-event-type";
import { ALL_EVENT_TYPES } from "@/app/(admin)/audit-logs/_lib/event-types";

const ALL_CATEGORIES = [
  "auth",
  "admin_invite",
  "order",
  "stripe",
  "review",
  "notification",
  "legal",
  "email",
  "catalog",
  "refund",
  "producers",
  "producer_interests",
] as const;

describe("categorizeEventType", () => {
  it("préfixe 'stripe_' → catégorie 'stripe'", () => {
    expect(categorizeEventType("stripe_dispute")).toBe("stripe");
    expect(categorizeEventType("stripe_payout_failed")).toBe("stripe");
    expect(categorizeEventType("stripe_default_payment_method_set")).toBe(
      "stripe",
    );
  });

  it("préfixe 'order_' → catégorie 'order'", () => {
    expect(categorizeEventType("order_created")).toBe("order");
    expect(categorizeEventType("order_payment_failed")).toBe("order");
    expect(categorizeEventType("order_refund_retry_exhausted")).toBe("order");
  });

  it("préfixe 'admin_invite_' → catégorie 'admin_invite' (pas 'auth')", () => {
    expect(categorizeEventType("admin_invite_sent")).toBe("admin_invite");
    expect(categorizeEventType("admin_invite_blocked_admin")).toBe(
      "admin_invite",
    );
    expect(categorizeEventType("admin_invite_expired")).toBe("admin_invite");
  });

  it("préfixe 'admin_legal_' / 'admin_audit_logs_' → catégorie 'legal'", () => {
    expect(categorizeEventType("admin_legal_compliance_exported")).toBe(
      "legal",
    );
    expect(categorizeEventType("admin_audit_logs_email_lookup")).toBe(
      "legal",
    );
  });

  it("préfixe 'admin_category_' / 'admin_animal_' / 'admin_cut_' → catégorie 'catalog' (T-130)", () => {
    expect(categorizeEventType("admin_category_created")).toBe("catalog");
    expect(categorizeEventType("admin_category_updated")).toBe("catalog");
    expect(categorizeEventType("admin_category_deleted")).toBe("catalog");
    expect(categorizeEventType("admin_animal_created")).toBe("catalog");
    expect(categorizeEventType("admin_animal_deleted")).toBe("catalog");
    expect(categorizeEventType("admin_cut_created")).toBe("catalog");
    expect(categorizeEventType("admin_cut_updated")).toBe("catalog");
    expect(categorizeEventType("admin_cut_deleted")).toBe("catalog");
  });

  it("préfixe 'producer_response_' → catégorie 'review'", () => {
    expect(categorizeEventType("producer_response_published")).toBe("review");
    expect(categorizeEventType("producer_response_removed_by_admin")).toBe(
      "review",
    );
  });

  it("préfixe 'refund_incident_' → catégorie 'refund' (PR3 admin-new-surfaces)", () => {
    expect(categorizeEventType("refund_incident_resolved_manually")).toBe(
      "refund",
    );
  });

  it("préfixe 'admin_review_' → catégorie 'review' (PR admin-pattern-uniform)", () => {
    expect(categorizeEventType("admin_review_published")).toBe("review");
    expect(categorizeEventType("admin_review_rejected")).toBe("review");
  });

  it("préfixe 'admin_producer_' → catégorie 'producers' (PR admin-pattern-uniform)", () => {
    expect(categorizeEventType("admin_producer_statut_changed")).toBe(
      "producers",
    );
  });

  it("préfixe 'admin_producer_interest_' → catégorie 'producer_interests' (avant admin_producer_)", () => {
    expect(
      categorizeEventType("admin_producer_interest_statut_changed"),
    ).toBe("producer_interests");
    expect(categorizeEventType("admin_producer_interest_deleted")).toBe(
      "producer_interests",
    );
  });

  it("préfixe 'notification_' → catégorie 'notification'", () => {
    expect(categorizeEventType("notification_preference_updated")).toBe(
      "notification",
    );
  });

  it("préfixe 'email_' → catégorie 'email' (delivery webhooks)", () => {
    expect(categorizeEventType("email_complaint_received")).toBe("email");
    expect(categorizeEventType("email_hard_bounce_suppressed")).toBe("email");
  });

  it("autres préfixes auth → catégorie 'auth' (fallback)", () => {
    expect(categorizeEventType("account_logout")).toBe("auth");
    expect(categorizeEventType("password_changed")).toBe("auth");
    expect(categorizeEventType("invitation_created")).toBe("auth");
    expect(categorizeEventType("login_failed")).toBe("auth");
    expect(categorizeEventType("rate_limit_exceeded")).toBe("auth");
    expect(categorizeEventType("admin_login")).toBe("auth");
    expect(categorizeEventType("role_changed")).toBe("auth");
    expect(categorizeEventType("email_change")).toBe("auth"); // pas le préfixe email_*
  });

  it("chaque event_type déclaré tombe dans une catégorie connue", () => {
    for (const t of ALL_EVENT_TYPES) {
      const cat = categorizeEventType(t);
      expect(ALL_CATEGORIES).toContain(cat);
      expect(CATEGORY_PALETTE[cat]).toBeDefined();
    }
  });
});

describe("CATEGORY_PALETTE", () => {
  it("expose une palette pour chaque catégorie", () => {
    for (const cat of ALL_CATEGORIES) {
      const p = CATEGORY_PALETTE[cat];
      expect(p.label).toBeTruthy();
      expect(p.bg).toMatch(/^bg-/);
      expect(p.text).toMatch(/^text-/);
      expect(p.dot).toMatch(/^bg-/);
    }
  });
});

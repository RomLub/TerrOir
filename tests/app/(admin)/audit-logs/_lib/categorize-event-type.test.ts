import { describe, it, expect, vi } from "vitest";

// `lib/audit-logs/log-auth-event.ts` (importé transitivement via
// _lib/event-types.ts) a `import "server-only"` — virtuel Next.js,
// non résolvable hors webpack. Stub no-op pour vitest.
vi.mock("server-only", () => ({}));

import {
  categorizeEventType,
  CATEGORY_PALETTE,
} from "@/app/(admin)/audit-logs/_lib/categorize-event-type";
import { ALL_EVENT_TYPES } from "@/app/(admin)/audit-logs/_lib/event-types";

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

  it("tous les autres préfixes auth → catégorie 'auth'", () => {
    expect(categorizeEventType("account_logout")).toBe("auth");
    expect(categorizeEventType("password_changed")).toBe("auth");
    expect(categorizeEventType("invitation_created")).toBe("auth");
    expect(categorizeEventType("login_failed")).toBe("auth");
    expect(categorizeEventType("rate_limit_exceeded")).toBe("auth");
    expect(categorizeEventType("admin_login")).toBe("auth");
    expect(categorizeEventType("role_changed")).toBe("auth");
    expect(categorizeEventType("email_change")).toBe("auth");
  });

  it("chaque event_type déclaré tombe dans une catégorie connue", () => {
    for (const t of ALL_EVENT_TYPES) {
      const cat = categorizeEventType(t);
      expect(["auth", "order", "stripe"]).toContain(cat);
      expect(CATEGORY_PALETTE[cat]).toBeDefined();
    }
  });
});

describe("CATEGORY_PALETTE", () => {
  it("expose une palette pour chaque catégorie", () => {
    for (const cat of ["auth", "order", "stripe"] as const) {
      const p = CATEGORY_PALETTE[cat];
      expect(p.label).toBeTruthy();
      expect(p.bg).toMatch(/^bg-/);
      expect(p.text).toMatch(/^text-/);
      expect(p.dot).toMatch(/^bg-/);
    }
  });
});

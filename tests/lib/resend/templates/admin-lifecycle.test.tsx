import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});
import AdminLifecycle, {
  subject,
  type AdminLifecycleKind,
} from "@/lib/resend/templates/admin-lifecycle";

// Chantier 6 — template email cycle de vie admin. On vérifie sujet + heading
// + CTA conditionnel par kind.

const ADMIN_URL = "https://admin.terroir-local.fr";

function html(kind: AdminLifecycleKind, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    AdminLifecycle({ kind, prenom: "Léa", adminUrl: ADMIN_URL, ...extra }),
  );
}

describe("template admin-lifecycle", () => {
  it("promoted : sujet + prénom + mention mot de passe + CTA admin", () => {
    expect(subject({ kind: "promoted", prenom: "Léa", adminUrl: ADMIN_URL })).toMatch(
      /administrateur/i,
    );
    const h = html("promoted");
    expect(h).toContain("Léa");
    expect(h).toMatch(/mot de passe/i);
    expect(h).toContain(ADMIN_URL);
  });

  it("suspended : pas de CTA admin", () => {
    const h = html("suspended");
    expect(h).toMatch(/suspendu/i);
    expect(h).not.toContain(ADMIN_URL);
  });

  it("revoked : compte client reste actif, pas de CTA", () => {
    const h = html("revoked");
    expect(h).toMatch(/compte client reste actif/i);
    expect(h).not.toContain(ADMIN_URL);
  });

  it("privilege_changed : reflète le nouveau niveau", () => {
    const h = html("privilege_changed", { newPrivilege: "super_admin" });
    expect(h).toMatch(/super-administrateur/i);
  });

  it("reactivated : CTA admin présent", () => {
    const h = html("reactivated");
    expect(h).toMatch(/réactivé/i);
    expect(h).toContain(ADMIN_URL);
  });
});

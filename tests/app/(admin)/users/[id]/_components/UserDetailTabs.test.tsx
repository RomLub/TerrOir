// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type {
  AdminUserDetail,
  AdminUserNotification,
  AdminUserOrder,
  AdminUserReview,
} from "@/lib/admin/users/types";

// Hoisted env stubs sinon @/components/ui throw au module-load (pattern
// teammates PR1).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// Imports directs (pas barrel @/components/ui) — piege jsdom Vitest documente
// par les teammates : le barrel casse les Server Component tests, on prefere
// imports directs.

import { UserDetailTabs } from "@/app/(admin)/users/[id]/_components/UserDetailTabs";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function render(node: ReactElement) {
  act(() => {
    root.render(node);
  });
}

function clickTab(key: string) {
  const btn = container.querySelector(
    `[role="tab"][data-tab="${key}"]`,
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`Onglet ${key} introuvable`);
  act(() => {
    btn.click();
  });
}

function getActivePanelKey(): string | null {
  const panel = container.querySelector('[role="tabpanel"]');
  return panel?.getAttribute("data-panel") ?? null;
}

function makeUser(o: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    id: "u1",
    email: "x@y.fr",
    prenom: "Jean",
    nom: "Dupont",
    telephone: null,
    role: "consumer",
    roles: ["consumer"],
    smsOptin: null,
    createdAt: "2026-01-15T12:00:00Z",
    lastSignInAt: null,
    emailConfirmedAt: null,
    phoneConfirmedAt: null,
    ...o,
  };
}

function makeOrder(o: Partial<AdminUserOrder> = {}): AdminUserOrder {
  return {
    id: "o1",
    codeCommande: "ABC123",
    createdAt: "2026-02-01T12:00:00Z",
    statut: "completed",
    montantTotal: 42.5,
    producerName: "Ferme A",
    ...o,
  };
}

function makeReview(o: Partial<AdminUserReview> = {}): AdminUserReview {
  return {
    id: "r1",
    createdAt: "2026-02-01T12:00:00Z",
    producerName: "Ferme A",
    note: 4,
    statut: "published",
    commentaireExcerpt: "Tres bon",
    ...o,
  };
}

function makeNotif(
  o: Partial<AdminUserNotification> = {},
): AdminUserNotification {
  return {
    id: "n1",
    createdAt: "2026-02-01T12:00:00Z",
    channel: "email",
    status: "sent",
    template: "order_confirmed_producer",
    subjectExcerpt: "Votre commande",
    ...o,
  };
}

function makeProps(over: Partial<Parameters<typeof UserDetailTabs>[0]> = {}) {
  return {
    user: makeUser(),
    orders: [],
    ordersError: null,
    reviews: [],
    reviewsError: null,
    notifications: [],
    notificationsError: null,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe("UserDetailTabs — onglet par defaut", () => {
  it("au mount, onglet Profil actif + email visible", () => {
    render(<UserDetailTabs {...makeProps()} />);
    expect(getActivePanelKey()).toBe("profil");
    const activeTab = container.querySelector('[role="tab"][data-active="true"]');
    expect(activeTab?.getAttribute("data-tab")).toBe("profil");
    expect(container.textContent).toContain("x@y.fr");
  });
});

describe("UserDetailTabs — clic onglet Commandes", () => {
  it("clic Commandes -> panel commandes visible, profil non visible", () => {
    render(
      <UserDetailTabs
        {...makeProps({
          orders: [makeOrder({ producerName: "Ferme XYZ" })],
        })}
      />,
    );
    clickTab("commandes");
    expect(getActivePanelKey()).toBe("commandes");
    expect(container.textContent).toContain("Ferme XYZ");
    expect(container.textContent).toContain("ABC123");
  });

  it("clic Commandes avec orders=[] -> message 'Aucune commande'", () => {
    render(<UserDetailTabs {...makeProps()} />);
    clickTab("commandes");
    expect(container.textContent).toContain("Aucune commande");
  });
});

describe("UserDetailTabs — clic onglet Reviews", () => {
  it("clic Reviews -> panel reviews visible avec contenu review", () => {
    render(
      <UserDetailTabs
        {...makeProps({
          reviews: [makeReview({ commentaireExcerpt: "Excellent producteur" })],
        })}
      />,
    );
    clickTab("reviews");
    expect(getActivePanelKey()).toBe("reviews");
    expect(container.textContent).toContain("Excellent producteur");
  });
});

describe("UserDetailTabs — clic onglet Notifications", () => {
  it("clic Notifications -> panel notifications visible + template lisible", () => {
    render(
      <UserDetailTabs
        {...makeProps({
          notifications: [
            makeNotif({ template: "producer_invitation", status: "sent" }),
          ],
        })}
      />,
    );
    clickTab("notifications");
    expect(getActivePanelKey()).toBe("notifications");
    expect(container.textContent).toContain("producer_invitation");
  });

  it("notifications=[] -> message 'Aucune notification'", () => {
    render(<UserDetailTabs {...makeProps()} />);
    clickTab("notifications");
    expect(container.textContent).toContain("Aucune notification");
  });

  it("notificationsError -> message d'erreur affiche", () => {
    render(
      <UserDetailTabs
        {...makeProps({ notificationsError: "RLS denied" })}
      />,
    );
    clickTab("notifications");
    expect(container.textContent).toContain("RLS denied");
  });
});

describe("UserDetailTabs — switch entre onglets ne perd pas l'etat", () => {
  it("commandes -> reviews -> profil : chaque onglet rerend son panel", () => {
    render(
      <UserDetailTabs
        {...makeProps({
          orders: [makeOrder()],
          reviews: [makeReview()],
        })}
      />,
    );
    clickTab("commandes");
    expect(getActivePanelKey()).toBe("commandes");
    clickTab("reviews");
    expect(getActivePanelKey()).toBe("reviews");
    clickTab("profil");
    expect(getActivePanelKey()).toBe("profil");
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { AdminAccountRow } from "@/lib/admin/admins/fetch";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

vi.mock("@/components/ui", () => ({
  AdminPageHeader: ({ error }: { error: string | null }) => (
    <div data-testid="hdr">{error ? <span data-testid="err">{error}</span> : null}</div>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button data-testid="promote-btn" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  TableActionButton: ({
    children,
    onClick,
    disabled,
    title,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
  }) => (
    <button
      data-testid="action"
      data-label={String(children)}
      data-disabled={disabled ? "1" : "0"}
      data-title={title ?? ""}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  ),
  TableStatus: ({ kind }: { kind: string }) => (
    <tr data-testid="empty" data-kind={kind}>
      <td />
    </tr>
  ),
}));

import { AdminsClient } from "@/app/(admin)/comptes-admins/_components/AdminsClient";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mockRefresh.mockReset();
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(node: ReactElement) {
  act(() => root.render(node));
}

function makeAdmin(over: Partial<AdminAccountRow> = {}): AdminAccountRow {
  return {
    id: "a1",
    email: "a@x.fr",
    fullName: "Romain Lubin",
    privilege: "super_admin",
    suspended: false,
    createdAt: "21 avr. 2026",
    ...over,
  };
}

function actions(label?: string): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="action"]'),
  ).filter((b) =>
    label ? (b as HTMLElement).dataset.label?.includes(label) : true,
  ) as HTMLButtonElement[];
}

describe("AdminsClient — défense en profondeur UI (chantier 6)", () => {
  it("super-admin : formulaire de promotion + actions visibles", () => {
    render(
      <AdminsClient
        admins={[makeAdmin({ id: "other", email: "b@x.fr" })]}
        initialError={null}
        currentAdminId="me"
        isSuperAdmin
      />,
    );
    expect(container.querySelector('[data-testid="promote-btn"]')).not.toBeNull();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(actions("Suspendre").length).toBe(1);
    expect(actions("Retirer").length).toBe(1);
  });

  it("ligne SOI-MÊME : Suspendre/Rétrograder/Retirer désactivés + tooltip", () => {
    render(
      <AdminsClient
        admins={[makeAdmin({ id: "me", email: "me@x.fr" })]}
        initialError={null}
        currentAdminId="me"
        isSuperAdmin
      />,
    );
    for (const label of ["Suspendre", "Rétrograder", "Retirer"]) {
      const btn = actions(label)[0];
      expect(btn, label).toBeDefined();
      expect(btn.dataset.disabled).toBe("1");
      expect(btn.dataset.title).toMatch(/vous-même/);
    }
  });

  it("autre admin actif : Suspendre activé (pas self)", () => {
    render(
      <AdminsClient
        admins={[makeAdmin({ id: "other" })]}
        initialError={null}
        currentAdminId="me"
        isSuperAdmin
      />,
    );
    expect(actions("Suspendre")[0].dataset.disabled).toBe("0");
  });

  it("admin suspendu : bouton Réactiver (pas Suspendre)", () => {
    render(
      <AdminsClient
        admins={[makeAdmin({ id: "other", suspended: true })]}
        initialError={null}
        currentAdminId="me"
        isSuperAdmin
      />,
    );
    expect(actions("Réactiver").length).toBe(1);
    expect(actions("Suspendre").length).toBe(0);
  });

  it("admin STANDARD : lecture seule (pas de formulaire, pas d'actions)", () => {
    render(
      <AdminsClient
        admins={[makeAdmin({ id: "other" })]}
        initialError={null}
        currentAdminId="me"
        isSuperAdmin={false}
      />,
    );
    expect(container.querySelector('[data-testid="promote-btn"]')).toBeNull();
    expect(actions().length).toBe(0);
  });
});

// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

// Tests RTL pour RevokeInvitationModal (chantier PR3
// feature/admin-new-surfaces). Pattern aligné PR1
// tests/app/(admin)/gestion-producteurs/GestionProducteursClient.test.tsx :
// react-dom/client createRoot + act() + click async + mock fetch + capture
// router.refresh.

// Hoisted env stubs — @/components/ui throw au module-load sans ces vars.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

const { mockRefresh } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

// Mock AdminModal — stub minimal qui rend children + footer en flat. On
// veut tester la logique de la modal, pas son shell visuel.
vi.mock("@/components/ui", () => ({
  AdminModal: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    open
      ? (
          <div data-testid="admin-modal" data-modal-title={title}>
            <div data-testid="modal-body">{children}</div>
            <div data-testid="modal-footer">{footer}</div>
          </div>
        )
      : null,
}));

import { RevokeInvitationModal } from "@/app/(admin)/invitations/_components/RevokeInvitationModal";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// --- Helpers DOM ---------------------------------------------------------

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockRefresh.mockReset();
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

async function clickAsync(btn: Element | null | undefined) {
  if (!btn) throw new Error("clickAsync: element introuvable");
  await act(async () => {
    (btn as HTMLElement).click();
  });
}

function findButtonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
}

function mockFetchOnce(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const INVITATION_ID = "inv-uuid-1";
const INVITATION_EMAIL = "producer@example.com";

function makeProps(overrides: Partial<{ onClose: () => void }> = {}) {
  return {
    invitationId: INVITATION_ID,
    invitationEmail: INVITATION_EMAIL,
    onClose: vi.fn(),
    ...overrides,
  };
}

// =========================================================================
// 1. Rendu initial — confirmation textuelle + email
// =========================================================================

describe("RevokeInvitationModal — rendu", () => {
  it("affiche la confirmation textuelle avec l'email cible", () => {
    render(<RevokeInvitationModal {...makeProps()} />);
    expect(
      container.querySelector('[data-testid="admin-modal"]'),
    ).not.toBeNull();
    const body = container.querySelector('[data-testid="modal-body"]');
    expect(body?.textContent).toContain("Cette action est irréversible");
    expect(body?.textContent).toContain(INVITATION_EMAIL);
  });

  it("affiche les 2 boutons Annuler + Confirmer", () => {
    render(<RevokeInvitationModal {...makeProps()} />);
    expect(findButtonByText("Annuler")).toBeDefined();
    expect(findButtonByText("Confirmer la révocation")).toBeDefined();
  });
});

// =========================================================================
// 2. Clic Confirmer → POST /api/admin/invitations/<id>/revoke
// =========================================================================

describe("RevokeInvitationModal — POST revoke", () => {
  it("clic Confirmer → POST sur la bonne URL avec body {}", async () => {
    mockFetchOnce(200, { id: INVITATION_ID, revoked_at: "2026-05-13T13:00:00Z" });
    render(<RevokeInvitationModal {...makeProps()} />);
    await clickAsync(findButtonByText("Confirmer la révocation"));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/admin/invitations/${INVITATION_ID}/revoke`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("HTTP 200 succès → router.refresh + onClose appelés", async () => {
    mockFetchOnce(200, { id: INVITATION_ID, revoked_at: "2026-05-13T13:00:00Z" });
    const onClose = vi.fn();
    render(<RevokeInvitationModal {...makeProps({ onClose })} />);
    await clickAsync(findButtonByText("Confirmer la révocation"));

    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("HTTP 409 → message 'déjà consommée' affiché + pas de refresh ni close", async () => {
    mockFetchOnce(409, {
      error: "Invitation déjà consommée, impossible de révoquer",
    });
    const onClose = vi.fn();
    render(<RevokeInvitationModal {...makeProps({ onClose })} />);
    await clickAsync(findButtonByText("Confirmer la révocation"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/déjà consommée/i);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("HTTP 500 sans body.error → fallback 'Erreur HTTP 500'", async () => {
    mockFetchOnce(500, {});
    render(<RevokeInvitationModal {...makeProps()} />);
    await clickAsync(findButtonByText("Confirmer la révocation"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Erreur HTTP 500");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("fetch rejette → message 'Erreur de connexion'", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    render(<RevokeInvitationModal {...makeProps()} />);
    await clickAsync(findButtonByText("Confirmer la révocation"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Erreur de connexion");
  });
});

// =========================================================================
// 3. Clic Annuler → onClose sans fetch
// =========================================================================

describe("RevokeInvitationModal — Annuler", () => {
  it("clic Annuler → onClose appelé sans POST", async () => {
    const onClose = vi.fn();
    render(<RevokeInvitationModal {...makeProps({ onClose })} />);
    await clickAsync(findButtonByText("Annuler"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

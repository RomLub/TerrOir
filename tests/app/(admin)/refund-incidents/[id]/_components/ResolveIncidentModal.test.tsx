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

// Tests RTL ResolveIncidentModal (PR3 feature/admin-new-surfaces). Pattern
// aligné PR1 GestionProducteursClient.test.tsx (RTL bas-niveau via
// react-dom/client + act, sans @testing-library — cohérent existing).

// Hoisted env stubs — sinon @/components/ui throw au module-load.
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
  useRouter: () => ({ refresh: mockRefresh }),
}));

// Mock @/components/ui : stubs minimaux qui rendent les enfants visibles
// + préservent les props observables (onClick, disabled).
vi.mock("@/components/ui", () => {
  return {
    AdminModal: ({
      open,
      children,
      footer,
      title,
    }: {
      open: boolean;
      children?: React.ReactNode;
      footer?: React.ReactNode;
      title: string;
      onClose?: () => void;
    }) =>
      open ? (
        <div data-testid="admin-modal" data-modal-title={title}>
          <div data-testid="modal-body">{children}</div>
          <div data-testid="modal-footer">{footer}</div>
        </div>
      ) : null,
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button
        data-testid="ui-button"
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    ),
  };
});

import { ResolveIncidentModal } from "@/app/(admin)/refund-incidents/[id]/_components/ResolveIncidentModal";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// --- Helpers DOM --------------------------------------------------------

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

function findUiButton(label: string): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll('[data-testid="ui-button"]'),
  ).find((b) => b.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined;
}

function getTextarea(): HTMLTextAreaElement {
  const ta = container.querySelector(
    "textarea#resolve-note",
  ) as HTMLTextAreaElement | null;
  if (!ta) throw new Error("textarea#resolve-note introuvable");
  return ta;
}

async function typeIntoTextarea(value: string) {
  const ta = getTextarea();
  // React (controlled inputs) ignore les writes naïfs ta.value = X car son
  // SyntheticEvent tracker compare la valeur stockée. On utilise le
  // descriptor du prototype natif pour bypasser ce tracker — pattern
  // classique pour tester un controlled input/textarea en jsdom.
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    nativeSetter?.call(ta, value);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function mockFetchOnce(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

const INCIDENT_ID = "incident-uuid-1";

function renderModal(open = true) {
  render(
    <ResolveIncidentModal
      open={open}
      incidentId={INCIDENT_ID}
      onClose={() => {}}
    />,
  );
}

// --- Tests --------------------------------------------------------------

describe("ResolveIncidentModal — validation note", () => {
  it("note vide → bouton Confirmer disabled", () => {
    renderModal();
    const btn = findUiButton("Confirmer");
    expect(btn).toBeDefined();
    expect(btn?.disabled).toBe(true);
  });

  it("note < 5 chars → bouton Confirmer disabled", async () => {
    renderModal();
    await typeIntoTextarea("abc");
    const btn = findUiButton("Confirmer");
    expect(btn?.disabled).toBe(true);
  });

  it("note >= 5 chars (trim) → bouton Confirmer activé", async () => {
    renderModal();
    await typeIntoTextarea("note valide");
    const btn = findUiButton("Confirmer");
    expect(btn?.disabled).toBe(false);
  });

  it("note avec uniquement des espaces → trim → disabled", async () => {
    renderModal();
    await typeIntoTextarea("     ");
    const btn = findUiButton("Confirmer");
    expect(btn?.disabled).toBe(true);
  });
});

describe("ResolveIncidentModal — submit POST", () => {
  it("succès → fetch POST avec note dans body + router.refresh()", async () => {
    mockFetchOnce(200, { id: INCIDENT_ID, status: "manually_resolved" });
    renderModal();
    await typeIntoTextarea("Virement effectué hors-Stripe");
    await clickAsync(findUiButton("Confirmer"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/admin/refund-incidents/${INCIDENT_ID}/resolve`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ note: "Virement effectué hors-Stripe" });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("HTTP 409 → affiche message non actionnable", async () => {
    mockFetchOnce(409, { error: "Incident dans un statut non actionnable" });
    renderModal();
    await typeIntoTextarea("note valide ici");
    await clickAsync(findUiButton("Confirmer"));

    expect(container.textContent).toContain("non actionnable");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("HTTP 500 → affiche message d'erreur générique", async () => {
    mockFetchOnce(500, { error: "Internal database error" });
    renderModal();
    await typeIntoTextarea("note ok");
    await clickAsync(findUiButton("Confirmer"));

    expect(container.textContent).toContain("Internal database error");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("HTTP 500 sans body parsable → message HTTP par défaut", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });
    renderModal();
    await typeIntoTextarea("note ok");
    await clickAsync(findUiButton("Confirmer"));

    expect(container.textContent).toContain("Erreur HTTP 500");
  });

  it("fetch network error → affiche message d'erreur réseau", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    renderModal();
    await typeIntoTextarea("note ok");
    await clickAsync(findUiButton("Confirmer"));

    expect(container.textContent).toContain("network down");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

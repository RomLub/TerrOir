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
import type { AdminProducerRow } from "@/lib/admin/producers/types";

// Hoisted env stubs — sinon @/components/ui throw au module-load.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// Mock next/navigation : on capture push / refresh + on contrôle
// useSearchParams par variable hoisted.
const { mockPush, mockRefresh, currentSearchParams } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  currentSearchParams: { value: "" as string },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => new URLSearchParams(currentSearchParams.value),
}));

// Mock @/components/ui : stubs minimaux qui rendent les enfants visibles +
// préservent les props observables (variant, status, onClick, href). Pas de
// styles ni de logique — on veut juste tester le contrôle de la page.
vi.mock("@/components/ui", () => {
  return {
    AdminPageHeader: ({
      error,
      right,
    }: {
      error: string | null;
      right: React.ReactNode;
    }) => (
      <div data-testid="admin-page-header">
        {error ? <div data-testid="header-error">{error}</div> : null}
        {right}
      </div>
    ),
    Button: ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => (
      <button data-testid="ui-button" onClick={onClick}>
        {children}
      </button>
    ),
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
    }) =>
      open ? (
        <div data-testid="admin-modal" data-modal-title={title}>
          <div data-testid="modal-body">{children}</div>
          <div data-testid="modal-footer">{footer}</div>
        </div>
      ) : null,
    FilterTabs: () => <div data-testid="filter-tabs" />,
    ProducerStatusBadge: ({ status }: { status: string }) => (
      <span data-testid="producer-status-badge" data-status={status} />
    ),
    TableActionButton: ({
      children,
      onClick,
      href,
      variant,
      disabled,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      href?: string;
      variant?: string;
      disabled?: boolean;
    }) => {
      if (href) {
        return (
          <a data-testid="table-action-link" data-variant={variant} href={href}>
            {children}
          </a>
        );
      }
      return (
        <button
          data-testid="table-action-btn"
          data-variant={variant}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </button>
      );
    },
    TableStatus: ({ kind }: { kind: string }) => (
      <tr data-testid="table-status" data-kind={kind}>
        <td />
      </tr>
    ),
    getProducerStatusLabel: (s: string) => `LABEL_${s}`,
  };
});

vi.mock("@/components/listings/ListingHeader", () => ({
  ListingHeader: ({ displayed, total }: { displayed: number; total: number }) => (
    <div data-testid="listing-header" data-displayed={displayed} data-total={total} />
  ),
}));

import { GestionProducteursClient } from "@/app/(admin)/gestion-producteurs/_components/GestionProducteursClient";

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
  mockPush.mockReset();
  mockRefresh.mockReset();
  currentSearchParams.value = "";
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

function findActionBtn(label: string): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll('[data-testid="table-action-btn"]'),
  ).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;
}

function findActionLink(label: string): HTMLAnchorElement | undefined {
  return Array.from(
    container.querySelectorAll('[data-testid="table-action-link"]'),
  ).find((a) => a.textContent?.includes(label)) as
    | HTMLAnchorElement
    | undefined;
}

function findUiButton(label: string): HTMLButtonElement | undefined {
  return Array.from(
    container.querySelectorAll('[data-testid="ui-button"]'),
  ).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;
}

function mockFetchOnce(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// --- Fixtures -----------------------------------------------------------

function makeProducer(
  overrides: Partial<AdminProducerRow> = {},
): AdminProducerRow {
  return {
    id: "p1",
    slug: "ferme-1",
    name: "Ferme 1",
    city: "Le Mans (72)",
    status: "active",
    plan: "Pro",
    joinedAt: "15 janv. 2026",
    email: "f1@example.com",
    userId: "u1",
    publicationRequested: false,
    bioPending: false,
    bioValidated: false,
    ...overrides,
  };
}

function makeProps(
  producers: AdminProducerRow[],
  overrides: Partial<Parameters<typeof GestionProducteursClient>[0]> = {},
) {
  return {
    initialProducers: producers,
    initialTotal: producers.length,
    initialNextCursor: null,
    initialError: null,
    showAll: false,
    isPaginated: false,
    ...overrides,
  };
}

// =======================================================================
// 1. fetch PATCH /api/admin/producers/[id]/statut
// =======================================================================

describe("GestionProducteursClient — fetch PATCH /api/admin/producers/[id]/statut", () => {
  it("clic Suspendre → PATCH avec body {statut:'suspended'} sur l'id du producer", async () => {
    mockFetchOnce(200, { id: "p1", statut: "suspended" });
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ id: "p1", status: "active" })])}
      />,
    );
    await clickAsync(findActionBtn("Suspendre"));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/producers/p1/statut");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ statut: "suspended" });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("clic Réactiver → PATCH avec body {statut:'active'}", async () => {
    mockFetchOnce(200, { id: "p2", statut: "active" });
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ id: "p2", status: "suspended" })])}
      />,
    );
    await clickAsync(findActionBtn("Réactiver"));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ statut: "active" });
  });

  it("HTTP 4xx avec body.error → message affiché dans le header", async () => {
    mockFetchOnce(400, { error: "Statut invalide" });
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ id: "p1", status: "active" })])}
      />,
    );
    await clickAsync(findActionBtn("Suspendre"));
    expect(
      container.querySelector('[data-testid="header-error"]')?.textContent,
    ).toBe("Statut invalide");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("HTTP 5xx sans body.error → fallback 'Erreur HTTP 500'", async () => {
    mockFetchOnce(500, {});
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ id: "p1", status: "active" })])}
      />,
    );
    await clickAsync(findActionBtn("Suspendre"));
    expect(
      container.querySelector('[data-testid="header-error"]')?.textContent,
    ).toBe("Erreur HTTP 500");
  });

  it("fetch rejette (réseau down) → message d'erreur affiché", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network failure"));
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ id: "p1", status: "active" })])}
      />,
    );
    await clickAsync(findActionBtn("Suspendre"));
    expect(
      container.querySelector('[data-testid="header-error"]')?.textContent,
    ).toBe("Network failure");
  });
});

// =======================================================================
// 2. Conditions visuelles des boutons d'action selon producer.status
// =======================================================================

describe("GestionProducteursClient — boutons d'action selon status", () => {
  it("status=pending : 'Valider' visible, 'Suspendre' et 'Réactiver' absents", () => {
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ status: "pending" })])}
      />,
    );
    expect(findActionBtn("Valider")).toBeDefined();
    expect(findActionBtn("Suspendre")).toBeUndefined();
    expect(findActionBtn("Réactiver")).toBeUndefined();
    expect(findActionLink("Voir page publique")).toBeUndefined();
  });

  it("status=active : 'Suspendre' visible, pas de 'Valider' ni 'Réactiver'", () => {
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ status: "active" })])}
      />,
    );
    expect(findActionBtn("Suspendre")).toBeDefined();
    expect(findActionBtn("Valider")).toBeUndefined();
    expect(findActionBtn("Réactiver")).toBeUndefined();
    expect(findActionLink("Voir page publique")).toBeUndefined();
  });

  it("status=public : 'Suspendre' + 'Voir page publique' (lien) visibles", () => {
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ status: "public", slug: "ferme-x" })])}
      />,
    );
    expect(findActionBtn("Suspendre")).toBeDefined();
    const link = findActionLink("Voir page publique");
    expect(link).toBeDefined();
    expect(link!.getAttribute("href")).toBe("/producteurs/ferme-x");
  });

  it("status=suspended : 'Réactiver' visible, pas de 'Suspendre' ni 'Valider'", () => {
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ status: "suspended" })])}
      />,
    );
    expect(findActionBtn("Réactiver")).toBeDefined();
    expect(findActionBtn("Suspendre")).toBeUndefined();
    expect(findActionBtn("Valider")).toBeUndefined();
  });

  it("status=draft : aucun bouton d'action visible (cellule actions vide)", () => {
    render(
      <GestionProducteursClient
        {...makeProps([makeProducer({ status: "draft" })], { showAll: true })}
      />,
    );
    expect(findActionBtn("Valider")).toBeUndefined();
    expect(findActionBtn("Suspendre")).toBeUndefined();
    expect(findActionBtn("Réactiver")).toBeUndefined();
    expect(findActionLink("Voir page publique")).toBeUndefined();
  });
});

// =======================================================================
// 3. Pré-fill search params (?invite= et ?user_id=) au mount
// =======================================================================

describe("GestionProducteursClient — pré-fill search params au mount", () => {
  it("?invite=<email> → InviteModal s'ouvre au mount avec email pré-rempli", () => {
    currentSearchParams.value = "invite=lead@example.com";
    render(<GestionProducteursClient {...makeProps([])} />);
    const modal = container.querySelector('[data-testid="admin-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute("data-modal-title")).toBe(
      "Inviter un producteur",
    );
    const emailInput = container.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement | null;
    expect(emailInput?.value).toBe("lead@example.com");
  });

  it("?user_id=<uuid valide> → banner bleu 'Filtré sur user' affiché + lien Effacer", () => {
    const uuid = "12345678-aaaa-bbbb-cccc-1234567890ab";
    currentSearchParams.value = `user_id=${uuid}`;
    render(
      <GestionProducteursClient
        {...makeProps([
          makeProducer({ id: "p1", userId: uuid }),
          makeProducer({ id: "p2", userId: "other" }),
        ])}
      />,
    );
    const banner = container.querySelector('[role="status"]');
    expect(banner?.textContent).toContain("Filtré sur user");
    expect(banner?.textContent).toContain(uuid.slice(0, 8));
    // Filtre appliqué : seul p1 reste dans la table
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(1);
  });

  it("?user_id=<uuid invalide> → banner ignoré, pas de filtre", () => {
    currentSearchParams.value = "user_id=not-a-uuid";
    render(
      <GestionProducteursClient
        {...makeProps([
          makeProducer({ id: "p1", userId: "u1" }),
          makeProducer({ id: "p2", userId: "u2" }),
        ])}
      />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
  });
});

// =======================================================================
// 4. Toggle showAll → router.push avec/sans show_all + reset cursor
// =======================================================================

describe("GestionProducteursClient — toggle showAll", () => {
  it("checkbox OFF → ON : router.push avec ?show_all=1 + reset cursor params", async () => {
    currentSearchParams.value = "before=2026-01-01T00:00:00Z&before_id=abc";
    render(
      <GestionProducteursClient
        {...makeProps([], { showAll: false, isPaginated: true })}
      />,
    );
    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await clickAsync(checkbox);
    expect(mockPush).toHaveBeenCalledOnce();
    const pushedUrl = mockPush.mock.calls[0][0] as string;
    expect(pushedUrl).toContain("show_all=1");
    expect(pushedUrl).not.toContain("before=");
    expect(pushedUrl).not.toContain("before_id=");
  });

  it("checkbox ON → OFF : router.push sans show_all", async () => {
    currentSearchParams.value = "show_all=1";
    render(
      <GestionProducteursClient
        {...makeProps([], { showAll: true })}
      />,
    );
    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await clickAsync(checkbox);
    const pushedUrl = mockPush.mock.calls[0][0] as string;
    expect(pushedUrl).not.toContain("show_all=1");
  });
});

// =======================================================================
// 5. InviteModal — 4 flux conditionnels
// =======================================================================

describe("GestionProducteursClient — InviteModal flux conditionnels", () => {
  function openInviteModal() {
    const inviteBtn = findUiButton("Inviter un producteur");
    if (!inviteBtn) throw new Error("Bouton Inviter introuvable");
    act(() => {
      inviteBtn.click();
    });
  }

  function setEmail(value: string) {
    const input = container.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submitForm() {
    const form = container.querySelector(
      "#admin-invite-form",
    ) as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { cancelable: true, bubbles: true }),
      );
    });
  }

  it("kind=draft_resend_confirm_required → encadré orange + bouton 'Confirmer la relance'", async () => {
    mockFetchOnce(409, { kind: "draft_resend_confirm_required" });
    render(<GestionProducteursClient {...makeProps([])} />);
    openInviteModal();
    setEmail("draft@example.com");
    await submitForm();

    const body = container.querySelector('[data-testid="modal-body"]');
    expect(body?.textContent).toContain(
      "Onboarding producteur abandonné détecté",
    );
    const footerBtn = container.querySelector(
      '[data-testid="modal-footer"] button[type="submit"]',
    );
    expect(footerBtn?.textContent).toContain("Confirmer la relance");
  });

  it("kind=blocked_admin → encadré 'compte administrateur', pas d'envoi", async () => {
    mockFetchOnce(409, { kind: "blocked_admin" });
    render(<GestionProducteursClient {...makeProps([])} />);
    openInviteModal();
    setEmail("admin@example.com");
    await submitForm();

    const body = container.querySelector('[data-testid="modal-body"]');
    expect(body?.textContent).toContain(
      "déjà rattaché à un compte administrateur",
    );
  });

  it("kind=blocked_producer avec statut → encadré rouge + statut affiché via getProducerStatusLabel", async () => {
    mockFetchOnce(409, { kind: "blocked_producer", statut: "active" });
    render(<GestionProducteursClient {...makeProps([])} />);
    openInviteModal();
    setEmail("dup@example.com");
    await submitForm();

    const body = container.querySelector('[data-testid="modal-body"]');
    expect(body?.textContent).toContain(
      "Un producteur est déjà inscrit avec cet email",
    );
    expect(body?.textContent).toContain("LABEL_active");
  });

  it("succès existing_account=consumer → écran 'Invitation envoyée' + encadré bleu upgrade", async () => {
    mockFetchOnce(200, { existing_account: "consumer" });
    render(<GestionProducteursClient {...makeProps([])} />);
    openInviteModal();
    setEmail("consumer@example.com");
    await submitForm();

    const modal = container.querySelector('[data-testid="admin-modal"]');
    expect(modal?.getAttribute("data-modal-title")).toBe("Invitation envoyée");
    const body = container.querySelector('[data-testid="modal-body"]');
    expect(body?.textContent).toContain(
      "Compte consumer existant détecté",
    );
    // router.refresh appelé après onSuccess (cf. handler InviteModal)
    expect(mockRefresh).toHaveBeenCalled();
  });
});

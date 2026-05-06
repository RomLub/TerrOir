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

// Hoisted env stubs avant les imports applicatifs.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

import { PickupValidationCard } from "@/app/(producer)/commandes/_components/PickupValidationCard";

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

function setInputValue(input: HTMLInputElement, value: string) {
  // React 18 écoute le DOM input event ; pour déclencher les listeners il
  // faut passer par le setter natif du prototype puis dispatcher un event.
  // Wrap dans act car le change handler appelle setState (warning sinon).
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickAsync(btn: HTMLButtonElement) {
  await act(async () => {
    btn.click();
  });
}

function findButtonByText(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );
}

function getInput(): HTMLInputElement {
  return container.querySelector(
    'input[aria-label="Code de retrait"]',
  ) as HTMLInputElement;
}

function mockFetchOnce(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// --- Fixtures -----------------------------------------------------------

const ORDER_ID = "order-1";
const CODE = "TRR-ABCDE";

const samplePreview = {
  id: ORDER_ID,
  code_commande: CODE,
  consumer_name: "Marie Dupont",
  items: [
    {
      name: "Saucisson sec",
      qty: "1,00 pièce",
      unit_price: 8,
      total: 8,
    },
  ],
  total_amount: 8,
  status: "confirmed",
  created_at: "2026-05-06T10:00:00Z",
};

const sampleValidated = {
  id: ORDER_ID,
  code_commande: CODE,
  consumer_name: "Marie Dupont",
  status: "completed" as const,
  completed_at: "2026-05-06T11:00:00Z",
};

// --- A. Rendu initial ---------------------------------------------------

describe("PickupValidationCard — rendu initial", () => {
  it("A1 affiche input + bouton 'Vérifier' disabled tant que code vide", () => {
    render(<PickupValidationCard />);
    expect(getInput()).not.toBeNull();
    const btn = findButtonByText("Vérifier");
    expect(btn).toBeDefined();
    expect(btn!.disabled).toBe(true);
  });

  it("A2 bouton Vérifier devient enabled après saisie", () => {
    render(<PickupValidationCard />);
    setInputValue(getInput(), CODE);
    const btn = findButtonByText("Vérifier");
    expect(btn!.disabled).toBe(false);
  });
});

// --- B. Flow nominal ----------------------------------------------------

describe("PickupValidationCard — flow nominal", () => {
  it("B1 Vérifier OK → modale preview affichée avec client + items + total", async () => {
    render(<PickupValidationCard />);
    setInputValue(getInput(), CODE);
    mockFetchOnce(200, { order: samplePreview });
    await clickAsync(findButtonByText("Vérifier")!);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(
      `/api/producer/orders/validate-pickup?code=${CODE}`,
    );
    expect((init as RequestInit).method).toBe("GET");

    expect(document.body.textContent).toContain("Marie Dupont");
    expect(document.body.textContent).toContain("Saucisson sec");
    expect(document.body.textContent).toContain("8,00 €");
    expect(findButtonByText("Confirmer la livraison")).toBeDefined();
    expect(findButtonByText("Annuler")).toBeDefined();
  });

  it("B2 modale Annuler → retour idle (modale fermée, input encore présent)", async () => {
    render(<PickupValidationCard />);
    setInputValue(getInput(), CODE);
    mockFetchOnce(200, { order: samplePreview });
    await clickAsync(findButtonByText("Vérifier")!);

    await clickAsync(findButtonByText("Annuler")!);

    expect(findButtonByText("Confirmer la livraison")).toBeUndefined();
    expect(getInput()).not.toBeNull();
  });

  it("B3 Confirmer → POST → état succès + callback onValidated invoqué", async () => {
    const onValidated = vi.fn();
    render(<PickupValidationCard onValidated={onValidated} />);
    setInputValue(getInput(), CODE);
    mockFetchOnce(200, { order: samplePreview });
    await clickAsync(findButtonByText("Vérifier")!);

    mockFetchOnce(200, { order: sampleValidated });
    await clickAsync(findButtonByText("Confirmer la livraison")!);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init2] = fetchMock.mock.calls[1]!;
    expect((init2 as RequestInit).method).toBe("POST");
    expect((init2 as RequestInit).body).toBe(JSON.stringify({ code: CODE }));

    expect(document.body.textContent).toContain("Commande remise à Marie");
    expect(onValidated).toHaveBeenCalledWith(ORDER_ID);
  });

  it("B4 succès → 'Valider une autre commande' reset à idle (input vide)", async () => {
    render(<PickupValidationCard />);
    setInputValue(getInput(), CODE);
    mockFetchOnce(200, { order: samplePreview });
    await clickAsync(findButtonByText("Vérifier")!);
    mockFetchOnce(200, { order: sampleValidated });
    await clickAsync(findButtonByText("Confirmer la livraison")!);

    await clickAsync(findButtonByText("Valider une autre commande")!);

    expect(document.body.textContent).not.toContain("Commande remise");
    expect(getInput().value).toBe("");
  });
});

// --- C. Erreurs ---------------------------------------------------------

describe("PickupValidationCard — erreurs", () => {
  it("C1 404 code_unknown → message in-place + reste idle", async () => {
    render(<PickupValidationCard />);
    setInputValue(getInput(), CODE);
    mockFetchOnce(404, { error: "pickup_code_unknown" });
    await clickAsync(findButtonByText("Vérifier")!);

    expect(document.body.textContent).toContain(
      "Code de retrait inconnu",
    );
    // Reste sur idle : la modale n'est pas ouverte
    expect(findButtonByText("Confirmer la livraison")).toBeUndefined();
  });

  it("C2 409 order_not_confirmed pending → message + lien detail_url", async () => {
    render(<PickupValidationCard />);
    setInputValue(getInput(), CODE);
    const detailUrl = "http://localhost:3001/commandes/order-1";
    mockFetchOnce(409, {
      error: "pickup_order_not_confirmed",
      current_status: "pending",
      detail_url: detailUrl,
    });
    await clickAsync(findButtonByText("Vérifier")!);

    expect(document.body.textContent).toContain(
      "n'a pas encore été confirmée",
    );
    const link = container.querySelector(`a[href="${detailUrl}"]`);
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("Voir la fiche commande");
  });

  it("C3 409 already_completed → message + date originale formatée", async () => {
    render(<PickupValidationCard />);
    setInputValue(getInput(), CODE);
    mockFetchOnce(409, {
      error: "pickup_already_completed",
      completed_at: "2026-05-05T14:30:00Z",
    });
    await clickAsync(findButtonByText("Vérifier")!);

    expect(document.body.textContent).toContain("Commande déjà remise");
    // Format français : doit contenir une date plausible (jour ou mois fr)
    expect(document.body.textContent).toMatch(/mai 2026|5 mai/);
  });

  it("C4 429 rate-limit → message + nombre de secondes", async () => {
    render(<PickupValidationCard />);
    setInputValue(getInput(), CODE);
    mockFetchOnce(429, {
      error: "rate_limit",
      retry_after_seconds: 42,
    });
    await clickAsync(findButtonByText("Vérifier")!);

    expect(document.body.textContent).toContain("Trop de tentatives");
    expect(document.body.textContent).toContain("42 secondes");
  });
});

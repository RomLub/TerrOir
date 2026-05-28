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

import { CancelAndCloseModal } from "@/app/(producer)/creneaux/_components/CancelAndCloseModal";
import type { BlockingOrder } from "@/app/(producer)/creneaux/actions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: Mock;

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function render(node: ReactElement) {
  act(() => root.render(node));
}

function makeOrder(over: Partial<BlockingOrder> = {}): BlockingOrder {
  return {
    id: "o1",
    code_commande: "ABC-001",
    consumer_prenom: "Marie",
    montant_total: 28.5,
    slot_starts_at: "2026-05-30T08:00:00Z",
    slot_ends_at: "2026-05-30T08:15:00Z",
    ...over,
  };
}

function getByTestId(id: string): HTMLElement {
  const el = container.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`Not found: data-testid="${id}"`);
  return el as HTMLElement;
}

function queryByTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

function rows(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="blocking-order-row"]'),
  ) as HTMLElement[];
}

function mockFetch200() {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ statut: "cancelled" }),
  });
}

function mockFetchSequence(responses: Array<{ ok: boolean; error?: string }>) {
  for (const r of responses) {
    if (r.ok) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    } else {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: r.error ?? "boom" }),
      });
    }
  }
}

// Helper pour attendre que la boucle séquentielle ait fini de progresser.
// useState + await fetch → microtasks, flush via Promise resolved en act.
async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("CancelAndCloseModal — rendu initial", () => {
  it("affiche la liste des commandes bloquantes avec consumer/code/montant/horaire", () => {
    render(
      <CancelAndCloseModal
        blockingOrders={[
          makeOrder({ id: "o1", consumer_prenom: "Marie", code_commande: "ABC-001", montant_total: 28.5 }),
          makeOrder({ id: "o2", consumer_prenom: "Paul", code_commande: "ABC-002", montant_total: 45 }),
        ]}
        onClose={() => {}}
        onAllCancelled={() => {}}
      />,
    );
    const lines = rows();
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toContain("Marie");
    expect(lines[0]!.textContent).toContain("ABC-001");
    expect(lines[0]!.textContent).toContain("28,50 €");
    expect(lines[0]!.textContent).toContain("Retrait :");
    expect(lines[1]!.textContent).toContain("Paul");
    expect(lines[1]!.textContent).toContain("45,00 €");
    // Deux CTAs visibles en idle.
    expect(queryByTestId("cancel-modal-keep-open")).not.toBeNull();
    expect(queryByTestId("cancel-modal-confirm")).not.toBeNull();
  });

  it("mentionne le score de fiabilité dans le bloc Conséquences", () => {
    render(
      <CancelAndCloseModal
        blockingOrders={[makeOrder()]}
        onClose={() => {}}
        onAllCancelled={() => {}}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/score de fiabilité/i);
    expect(text).toMatch(/visible par vos clients/i);
    // Les deux autres conséquences sont aussi présentes.
    expect(text).toMatch(/remboursés/i);
    expect(text).toMatch(/email/i);
  });
});

describe("CancelAndCloseModal — fermeture sans action", () => {
  it("clic sur 'Garder le créneau ouvert' → onClose appelé", () => {
    const onClose = vi.fn();
    render(
      <CancelAndCloseModal
        blockingOrders={[makeOrder()]}
        onClose={onClose}
        onAllCancelled={() => {}}
      />,
    );
    act(() => {
      getByTestId("cancel-modal-keep-open").click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CancelAndCloseModal — succès complet", () => {
  it("clic sur 'Annuler et fermer' → boucle séquentielle → onAllCancelled appelé", async () => {
    const onAllCancelled = vi.fn();
    mockFetchSequence([{ ok: true }, { ok: true }]);
    render(
      <CancelAndCloseModal
        blockingOrders={[
          makeOrder({ id: "o1" }),
          makeOrder({ id: "o2", code_commande: "B" }),
        ]}
        onClose={() => {}}
        onAllCancelled={onAllCancelled}
      />,
    );
    act(() => {
      getByTestId("cancel-modal-confirm").click();
    });
    await flushPromises();

    // 2 appels POST /api/orders/:id/cancel séquentiels.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/orders/o1/cancel");
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/orders/o2/cancel");
    // Body reason=producer_cancel.
    const body0 = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body0.reason).toBe("producer_cancel");
    // onAllCancelled appelé à la fin.
    expect(onAllCancelled).toHaveBeenCalledTimes(1);
    // Toutes les rows ont status="ok".
    const okRows = rows().filter((r) => r.dataset.status === "ok");
    expect(okRows).toHaveLength(2);
  });
});

describe("CancelAndCloseModal — échec partiel", () => {
  it("1 OK + 1 KO → modale reste ouverte, onAllCancelled NON appelé, bouton Réessayer visible", async () => {
    const onAllCancelled = vi.fn();
    const onClose = vi.fn();
    mockFetchSequence([{ ok: true }, { ok: false, error: "Stripe down" }]);
    render(
      <CancelAndCloseModal
        blockingOrders={[
          makeOrder({ id: "o1", consumer_prenom: "Marie" }),
          makeOrder({ id: "o2", consumer_prenom: "Paul" }),
        ]}
        onClose={onClose}
        onAllCancelled={onAllCancelled}
      />,
    );
    act(() => {
      getByTestId("cancel-modal-confirm").click();
    });
    await flushPromises();

    expect(onAllCancelled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Bouton retry visible, idle confirm caché.
    expect(queryByTestId("cancel-modal-retry-failed")).not.toBeNull();
    expect(queryByTestId("cancel-modal-confirm")).toBeNull();
    // o1 marquée ok, o2 marquée fail avec message.
    const list = rows();
    const r1 = list.find((r) => r.dataset.orderId === "o1")!;
    const r2 = list.find((r) => r.dataset.orderId === "o2")!;
    expect(r1.dataset.status).toBe("ok");
    expect(r2.dataset.status).toBe("fail");
    expect(r2.textContent).toContain("Stripe down");
  });

  it("Retry sur échec partiel : ne retente QUE les commandes échouées", async () => {
    const onAllCancelled = vi.fn();
    // 1er run : o1 OK, o2 KO. Retry : o2 OK.
    mockFetchSequence([
      { ok: true },
      { ok: false, error: "transient" },
      { ok: true }, // retry o2
    ]);
    render(
      <CancelAndCloseModal
        blockingOrders={[
          makeOrder({ id: "o1" }),
          makeOrder({ id: "o2" }),
        ]}
        onClose={() => {}}
        onAllCancelled={onAllCancelled}
      />,
    );
    act(() => {
      getByTestId("cancel-modal-confirm").click();
    });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onAllCancelled).not.toHaveBeenCalled();

    // Retry
    act(() => {
      getByTestId("cancel-modal-retry-failed").click();
    });
    await flushPromises();
    // Le retry n'appelle QUE o2 (la failed). Total = 3 calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/orders/o2/cancel");
    // Toutes OK maintenant → onAllCancelled appelé.
    expect(onAllCancelled).toHaveBeenCalledTimes(1);
  });
});

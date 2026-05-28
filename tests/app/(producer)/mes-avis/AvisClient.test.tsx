// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvisClient, type AvisRow } from "@/app/(producer)/mes-avis/AvisClient";
import { getReviewConversationState } from "@/lib/producers/review-conversation-state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, readAt: "2026-05-20T12:00:00.000Z" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(node: ReactElement) {
  act(() => {
    root.render(node);
  });
}

function makeRow(overrides: Partial<AvisRow>): AvisRow {
  const base = {
    id: "review-1",
    author: "Alice D.",
    rating: 5,
    comment: "Tres bon produit",
    createdAt: "2026-05-20T10:00:00.000Z",
    publishedAt: "2026-05-20T10:00:00.000Z",
    response: null,
    responseAt: null,
    responseUpdatedAt: null,
    responseLockedAt: null,
    responseStatus: null,
    producerReadAt: null,
  } satisfies Omit<
    AvisRow,
    "lastMessageSender" | "lastMessageAt" | "needsResponse" | "unread"
  >;
  const row = { ...base, ...overrides };
  return {
    ...row,
    ...getReviewConversationState({
      createdAt: row.createdAt,
      publishedAt: row.publishedAt,
      producerResponse: row.response,
      producerResponseAt: row.responseAt,
      producerResponseUpdatedAt: row.responseUpdatedAt,
      producerResponseStatus: row.responseStatus,
      producerReadAt: row.producerReadAt,
    }),
  };
}

function findButton(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((node) =>
    (node.textContent ?? "").includes(label),
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Bouton introuvable: ${label}`);
  return button;
}

async function clickButton(label: string) {
  const button = findButton(label);
  await act(async () => {
    button.click();
  });
}

describe("AvisClient", () => {
  it("affiche l'indicateur Nouveau et les compteurs operationnels sans marquer lu au chargement", () => {
    render(<AvisClient initialRows={[makeRow({})]} />);

    expect(container.textContent).toContain("1 à répondre");
    expect(container.textContent).toContain("1 non lus");
    expect(container.textContent).toContain("Nouveau");
    expect(container.textContent).not.toContain("avec réponse");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filtre la vue Non lus sans confondre avec les avis lus a repondre", async () => {
    render(
      <AvisClient
        initialRows={[
          makeRow({ id: "unread", author: "Alice D.", producerReadAt: null }),
          makeRow({
            id: "read",
            author: "Bruno L.",
            producerReadAt: "2026-05-20T11:00:00.000Z",
          }),
        ]}
      />,
    );

    await clickButton("Non lus");

    expect(container.textContent).toContain("Alice D.");
    expect(container.textContent).not.toContain("Bruno L.");
  });

  it("trie les avis a repondre avant les avis repondus", () => {
    render(
      <AvisClient
        initialRows={[
          makeRow({
            id: "answered",
            author: "Zoe M.",
            response: "Merci",
            responseAt: "2026-05-21T10:00:00.000Z",
            responseStatus: "published",
          }),
          makeRow({
            id: "needs-response",
            author: "Alice D.",
            producerReadAt: "2026-05-20T11:00:00.000Z",
          }),
        ]}
      />,
    );

    const text = container.textContent ?? "";
    expect(text.indexOf("Alice D.")).toBeLessThan(text.indexOf("Zoe M."));
  });

  it("ouvre une conversation et marque Nouveau comme lu", async () => {
    render(<AvisClient initialRows={[makeRow({ id: "review-read" })]} />);

    await clickButton("Ouvrir");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/producer/reviews/review-read/read",
      { method: "POST" },
    );
    expect(container.textContent).not.toContain("Nouveau");
    expect(container.textContent).toContain("1 à répondre");
    expect(container.textContent).toContain("0 non lus");
    expect(container.textContent).toContain("Répondre à cet avis");
  });

  it("apres lecture, l'avis reste dans À répondre tant que le dernier message vient du client", async () => {
    render(<AvisClient initialRows={[makeRow({})]} />);

    await clickButton("Ouvrir");
    await clickButton("À répondre");

    expect(container.textContent).toContain("Alice D.");
    expect(container.textContent).toContain("0 non lus");
  });

  it("relance client apres lecture : le badge Nouveau revient", () => {
    render(
      <AvisClient
        initialRows={[
          makeRow({
            response: "Merci",
            responseAt: "2026-05-20T11:00:00.000Z",
            responseStatus: "published",
            producerReadAt: "2026-05-20T12:00:00.000Z",
            publishedAt: "2026-05-21T09:00:00.000Z",
          }),
        ]}
      />,
    );

    expect(container.textContent).toContain("Nouveau");
    expect(container.textContent).toContain("1 à répondre");
  });
});

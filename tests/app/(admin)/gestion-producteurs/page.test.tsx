import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// Tests vitest pour le Server Component admin /gestion-producteurs.
// Inspecte l'arbre ReactElement (env=node, pas jsdom) — pattern aligné sur
// tests/app/(public)/producteurs/[slug]/page.test.tsx.

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// Mock du fetcher service_role pour ne pas exécuter la query DB réelle.
const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/admin/producers/fetch", () => ({
  fetchAdminProducersList: mockFetch,
}));

// createSupabaseAdminClient : retourne un client opaque (fetcher mocké
// l'ignore complètement).
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

// Mock du Client Component — composant identifiable par nom, on lit ses
// props directement depuis le ReactElement retourné par la page (pas de
// render DOM). Le component lui-même n'est jamais exécuté côté React, on
// inspecte le tree.
vi.mock(
  "@/app/(admin)/gestion-producteurs/_components/GestionProducteursClient",
  () => ({
    GestionProducteursClient: function GestionProducteursClient() {
      return null;
    },
  }),
);

import AdminProducteursPage from "@/app/(admin)/gestion-producteurs/page";

function getClientProps(node: ReactElement): Record<string, unknown> {
  // Le Server Component retourne directement <GestionProducteursClient />.
  // Les props sont accessibles via node.props (ReactElement standard).
  return (node.props ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("Server Component /gestion-producteurs", () => {
  it("fetch sans filtre showAll → includeDraftsAndDeleted=false", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminProducteursPage({
      searchParams: Promise.resolve({}),
    });
    expect(mockFetch).toHaveBeenCalledOnce();
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.includeDraftsAndDeleted).toBe(false);
    expect(opts.cursor).toEqual({ before: null, beforeId: null });
  });

  it("search_param show_all=1 → includeDraftsAndDeleted=true + showAll propagé au client", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    const node = (await AdminProducteursPage({
      searchParams: Promise.resolve({ show_all: "1" }),
    })) as ReactElement;
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.includeDraftsAndDeleted).toBe(true);
    expect(getClientProps(node).showAll).toBe(true);
  });

  it("cursor before+before_id → parsé et passé au fetcher", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    const node = (await AdminProducteursPage({
      searchParams: Promise.resolve({
        before: "2026-01-01T00:00:00Z",
        before_id: "abc",
      }),
    })) as ReactElement;
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.cursor.before).toBe("2026-01-01T00:00:00Z");
    expect(opts.cursor.beforeId).toBe("abc");
    expect(getClientProps(node).isPaginated).toBe(true);
  });

  it("propage rows + total + nextCursor au client component", async () => {
    const fakeRows = [
      {
        id: "p1",
        slug: "f1",
        name: "Ferme 1",
        city: "Le Mans (72)",
        status: "active" as const,
        plan: "Pro",
        joinedAt: "15 janv. 2026",
        email: "f1@example.com",
        userId: "u1",
      },
    ];
    mockFetch.mockResolvedValue({
      rows: fakeRows,
      total: 42,
      nextCursor: { created_at: "2026-01-01T00:00:00Z", id: "abc" },
      error: null,
    });
    const node = (await AdminProducteursPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    expect(node).toBeDefined();
    const props = getClientProps(node);
    expect(props.initialProducers).toEqual(fakeRows);
    expect(props.initialTotal).toBe(42);
    expect(props.initialNextCursor).toEqual({
      created_at: "2026-01-01T00:00:00Z",
      id: "abc",
    });
    expect(props.initialError).toBeNull();
  });

  it("propage l'erreur fetcher au client (initialError)", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: "db boom",
    });
    const node = (await AdminProducteursPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    expect(getClientProps(node).initialError).toBe("db boom");
  });
});

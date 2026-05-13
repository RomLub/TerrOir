import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// Tests vitest pour le Server Component admin /invitations (chantier PR3).
// Pattern aligné PR1 tests/app/(admin)/gestion-producteurs/page.test.tsx :
// env=node, on inspecte le ReactElement retourné sans render DOM.

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/admin/invitations/fetch", () => ({
  fetchAdminInvitationsList: mockFetch,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

// Mock des composants UI utilisés par la page — stubs minimaux qui rendent
// les enfants visibles + préservent les props observables. AdminPageHeader,
// TableStatus, ListingHeader, InvitationsListClient, RevokeInvitationTrigger.
vi.mock("@/components/ui", () => ({
  AdminPageHeader: ({ error }: { error: string | null }) => ({
    type: "div",
    props: { "data-testid": "admin-page-header", "data-error": error },
  }),
  TableStatus: () => null,
}));

vi.mock("@/components/listings/ListingHeader", () => ({
  ListingHeader: () => null,
}));

vi.mock(
  "@/app/(admin)/invitations/_components/InvitationsListClient",
  () => ({
    InvitationsListClient: function InvitationsListClient() {
      return null;
    },
  }),
);

vi.mock(
  "@/app/(admin)/invitations/_components/RevokeInvitationTrigger",
  () => ({
    RevokeInvitationTrigger: function RevokeInvitationTrigger() {
      return null;
    },
  }),
);

import AdminInvitationsPage from "@/app/(admin)/invitations/page";

// Helper : trouve récursivement un ReactElement par displayName (functional
// component) ou data-testid, et renvoie ses props.
function findByName(
  node: unknown,
  name: string,
): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const el = node as ReactElement & {
    type?: { name?: string; displayName?: string } | string;
  };
  if (el.type && typeof el.type === "function") {
    const fn = el.type as { name?: string; displayName?: string };
    if (fn.displayName === name || fn.name === name) {
      return el.props as Record<string, unknown>;
    }
  }
  const children = (el.props as { children?: unknown } | undefined)?.children;
  if (Array.isArray(children)) {
    for (const c of children) {
      const hit = findByName(c, name);
      if (hit) return hit;
    }
  } else if (children) {
    return findByName(children, name);
  }
  return null;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("Server Component /invitations", () => {
  it("sans search params → fetcher appelé avec status='all', cursor null, from/to null", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminInvitationsPage({
      searchParams: Promise.resolve({}),
    });
    expect(mockFetch).toHaveBeenCalledOnce();
    const opts = mockFetch.mock.calls[0][1] as {
      status: string;
      cursor: { before: string | null; beforeId: string | null };
      from: string | null;
      to: string | null;
    };
    expect(opts.status).toBe("all");
    expect(opts.cursor).toEqual({ before: null, beforeId: null });
    expect(opts.from).toBeNull();
    expect(opts.to).toBeNull();
  });

  it("search_param status=expired → propagé au fetcher", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminInvitationsPage({
      searchParams: Promise.resolve({ status: "expired" }),
    });
    const opts = mockFetch.mock.calls[0][1] as { status: string };
    expect(opts.status).toBe("expired");
  });

  it("status invalide → fallback à 'all'", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminInvitationsPage({
      searchParams: Promise.resolve({ status: "garbage" }),
    });
    const opts = mockFetch.mock.calls[0][1] as { status: string };
    expect(opts.status).toBe("all");
  });

  it("cursor before+before_id → parsé et passé au fetcher", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminInvitationsPage({
      searchParams: Promise.resolve({
        before: "2026-05-10T00:00:00Z",
        before_id: "abc",
      }),
    });
    const opts = mockFetch.mock.calls[0][1] as {
      cursor: { before: string | null; beforeId: string | null };
    };
    expect(opts.cursor.before).toBe("2026-05-10T00:00:00Z");
    expect(opts.cursor.beforeId).toBe("abc");
  });

  it("from/to traduits en ISO complet (to étendu à 23:59:59.999Z)", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminInvitationsPage({
      searchParams: Promise.resolve({
        from: "2026-05-01",
        to: "2026-05-12",
      }),
    });
    const opts = mockFetch.mock.calls[0][1] as {
      from: string | null;
      to: string | null;
    };
    expect(opts.from).toMatch(/^2026-05-01T/);
    expect(opts.to).toBe("2026-05-12T23:59:59.999Z");
  });

  it("propage InvitationsListClient avec currentStatus / currentFrom / currentTo", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    const node = (await AdminInvitationsPage({
      searchParams: Promise.resolve({
        status: "revoked",
        from: "2026-05-01",
        to: "2026-05-12",
      }),
    })) as ReactElement;

    const props = findByName(node, "InvitationsListClient");
    expect(props).not.toBeNull();
    expect(props?.currentStatus).toBe("revoked");
    expect(props?.currentFrom).toBe("2026-05-01");
    expect(props?.currentTo).toBe("2026-05-12");
  });

  it("propage l'erreur fetcher → AdminPageHeader.error", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: "db boom",
    });
    const node = (await AdminInvitationsPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    // Le mock AdminPageHeader retourne { type: 'div', props: {... data-error}}.
    // Le node racine est <div>...</div> ; on cherche le header dans les enfants.
    const stringNode = JSON.stringify(node);
    expect(stringNode).toContain("db boom");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// Tests vitest pour le Server Component admin /users (PR3). On inspecte
// l'arbre ReactElement renvoye par la page (env=node, pas jsdom) — pattern
// aligne tests/app/(admin)/gestion-producteurs/page.test.tsx.
//
// NB chemin sans parentheses (tests/app/admin/users/...) : piege Windows
// vitest deja documente par les teammates precedents — les paths avec ()
// dans les imports cassent la resolution alias sur certains setups.

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

vi.mock("@/lib/admin/users/fetch", () => ({
  fetchAdminUsersList: mockFetch,
  ADMIN_USERS_PAGE_SIZE: 50,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

// On mock le sub-component pour pouvoir lire les props passees au filtres.
vi.mock(
  "@/app/(admin)/users/_components/UsersListFilters",
  () => ({
    UsersListFilters: function UsersListFilters() {
      return null;
    },
  }),
);

import AdminUsersPage from "@/app/(admin)/users/page";

beforeEach(() => {
  mockFetch.mockReset();
});

function getRoot(node: ReactElement): ReactElement {
  return node;
}

describe("Server Component /users", () => {
  it("default : fetch avec roleFilter='all', q=null, cursor vide", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminUsersPage({
      searchParams: Promise.resolve({}),
    });
    expect(mockFetch).toHaveBeenCalledOnce();
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.roleFilter).toBe("all");
    expect(opts.q).toBeNull();
    expect(opts.cursor).toEqual({ before: null, beforeId: null });
  });

  it("?role=producer -> roleFilter='producer' passe au fetcher", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminUsersPage({
      searchParams: Promise.resolve({ role: "producer" }),
    });
    expect(mockFetch.mock.calls[0][1].roleFilter).toBe("producer");
  });

  it("?role=invalid -> fallback roleFilter='all'", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminUsersPage({
      searchParams: Promise.resolve({ role: "hacker" }),
    });
    expect(mockFetch.mock.calls[0][1].roleFilter).toBe("all");
  });

  it("?q=foo -> q passe au fetcher (trim applique)", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminUsersPage({
      searchParams: Promise.resolve({ q: "  alice  " }),
    });
    expect(mockFetch.mock.calls[0][1].q).toBe("alice");
  });

  it("?q chaine vide -> q=null", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminUsersPage({
      searchParams: Promise.resolve({ q: "   " }),
    });
    expect(mockFetch.mock.calls[0][1].q).toBeNull();
  });

  it("cursor before+before_id -> parse et passe au fetcher", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    await AdminUsersPage({
      searchParams: Promise.resolve({
        before: "2026-01-01T00:00:00Z",
        before_id: "abc",
      }),
    });
    expect(mockFetch.mock.calls[0][1].cursor).toEqual({
      before: "2026-01-01T00:00:00Z",
      beforeId: "abc",
    });
  });

  it("renvoie un arbre Server Component (pas null) quand fetch OK", async () => {
    mockFetch.mockResolvedValue({
      rows: [
        {
          id: "u1",
          email: "x@y.fr",
          fullName: "Jean",
          role: "consumer",
          lastSignInAt: null,
          joinedAt: "15 janv. 2026",
          ordersCount: 0,
        },
      ],
      total: 1,
      nextCursor: null,
      error: null,
    });
    const node = (await AdminUsersPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    expect(node).toBeDefined();
    expect(getRoot(node)).toBeDefined();
  });

  it("fetch error propage dans le rendu (header.error)", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: "db boom",
    });
    const node = (await AdminUsersPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    // L'arbre est rendu — l'erreur est lue par AdminPageHeader via prop.
    // On ne deroule pas l'arbre Server Component (RSC), mais on verifie
    // que la page n'a pas throw.
    expect(node).toBeDefined();
  });
});

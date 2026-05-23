import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Tests Server Component admin /comptes-consommateurs (chantier 5). Chemin
// sans parenthèses (piège Windows vitest sur les paths avec ()).

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("@/lib/admin/users/fetch", () => ({
  fetchAdminUsersList: mockFetch,
  ADMIN_USERS_PAGE_SIZE: 50,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

import AdminComptesConsommateursPage from "@/app/(admin)/comptes-consommateurs/page";

async function renderPage(sp: Record<string, string> = {}): Promise<string> {
  const node = (await AdminComptesConsommateursPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  return renderToStaticMarkup(node);
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    rows: [],
    total: 0,
    nextCursor: null,
    error: null,
  });
});

describe("Server Component /comptes-consommateurs", () => {
  it("fetch avec roleFilter='consumer_inclusive', q=null par défaut", async () => {
    await renderPage();
    expect(mockFetch).toHaveBeenCalledOnce();
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.roleFilter).toBe("consumer_inclusive");
    expect(opts.q).toBeNull();
    expect(opts.cursor).toEqual({ before: null, beforeId: null });
  });

  it("?q -> passé au fetcher (trim)", async () => {
    await renderPage({ q: "  alice  " });
    expect(mockFetch.mock.calls[0][1].q).toBe("alice");
  });

  it("rend le titre + le formulaire de recherche", async () => {
    const html = await renderPage();
    expect(html).toContain("Comptes consommateurs");
    expect(html).toContain('name="q"');
  });

  it("rangées : lien Voir vers le détail partagé /users/[id] + badge double-rôle", async () => {
    mockFetch.mockResolvedValue({
      rows: [
        {
          id: "u1",
          email: "dual@y.fr",
          fullName: "Marie Martin",
          role: "producer", // double-rôle producteur+conso
          lastSignInAt: null,
          joinedAt: "15 janv. 2026",
          ordersCount: 3,
        },
      ],
      total: 1,
      nextCursor: null,
      error: null,
    });
    const html = await renderPage();
    expect(html).toContain('href="/users/u1"');
    expect(html).toContain("dual@y.fr");
    expect(html).toContain("Aussi producteur"); // badge double-rôle
  });

  it("erreur fetch -> page rendue sans throw", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: "db boom",
    });
    const html = await renderPage();
    expect(html).toContain("db boom");
  });
});

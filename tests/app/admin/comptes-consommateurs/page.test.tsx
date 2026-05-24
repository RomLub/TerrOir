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

import AdminComptesConsommateursPage, {
  ComptesContent,
} from "@/app/(admin)/comptes-consommateurs/page";

// renderPage : markup synchrone de la page (en-tête + formulaire de recherche).
// Lot B perf : la liste est désormais streamée en <Suspense>, donc ce markup
// ne contient PAS les lignes (le fallback skeleton les remplace). On l'utilise
// pour les assertions sur le titre / le formulaire.
async function renderPage(sp: Record<string, string> = {}): Promise<string> {
  const node = (await AdminComptesConsommateursPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  return renderToStaticMarkup(node);
}

// renderContent : extrait le <ComptesContent> du <Suspense> rendu par la page
// (on teste donc le parsing searchParams réel), puis l'exécute pour obtenir le
// markup de la liste (fetch + lignes). C'est là que vit la logique data.
async function renderContent(sp: Record<string, string> = {}): Promise<string> {
  const page = (await AdminComptesConsommateursPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  // Le <Suspense> est le dernier enfant du <div> racine.
  const children = (page.props as { children?: unknown }).children;
  const arr = (Array.isArray(children) ? children : [children]).flat();
  const suspense = arr.find(
    (c): c is ReactElement & { props: { children?: ReactElement } } =>
      !!c &&
      typeof c === "object" &&
      "props" in c &&
      typeof (
        (c as { props?: { children?: ReactElement } }).props?.children as
          | { type?: unknown }
          | undefined
      )?.type === "function",
  );
  const content = suspense?.props.children;
  if (!content) throw new Error("ComptesContent introuvable dans le <Suspense>");
  const resolved = (await ComptesContent(
    content.props as Parameters<typeof ComptesContent>[0],
  )) as ReactElement;
  return renderToStaticMarkup(resolved);
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
    await renderContent();
    expect(mockFetch).toHaveBeenCalledOnce();
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.roleFilter).toBe("consumer_inclusive");
    expect(opts.q).toBeNull();
    expect(opts.cursor).toEqual({ before: null, beforeId: null });
  });

  it("?q -> passé au fetcher (trim)", async () => {
    await renderContent({ q: "  alice  " });
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
    const html = await renderContent();
    expect(html).toContain('href="/users/u1"');
    expect(html).toContain("dual@y.fr");
    expect(html).toContain("Aussi producteur"); // badge double-rôle
  });

  it("erreur fetch -> contenu rendu sans throw", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: "db boom",
    });
    const html = await renderContent();
    expect(html).toContain("db boom");
  });
});

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

// Lot B perf (pattern Gate) : la page synchrone retourne
// <div><AdminPageHeader/><Suspense><ComptesGate/></Suspense></div>. Le Gate
// (async) await + parse le searchParams (q + cursor), rend le <form> de
// recherche puis délègue à <ComptesContent/> (async) qui fait le fetch + la
// liste. resolveGate extrait le <ComptesGate/> du <Suspense> (on teste donc le
// parsing searchParams réel) et l'exécute pour obtenir son output (fragment
// form + <ComptesContent/>).
async function resolveGate(sp: Record<string, string>): Promise<ReactElement> {
  const page = (await AdminComptesConsommateursPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  // Le <Suspense> est un des enfants du <div> racine (à côté de l'en-tête).
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
  const gate = suspense?.props.children;
  if (!gate) throw new Error("ComptesGate introuvable dans le <Suspense>");
  const Gate = gate.type as (
    props: unknown,
  ) => Promise<ReactElement> | ReactElement;
  return (await Gate(gate.props)) as ReactElement;
}

// renderPage : markup statique de la page (en-tête + titre) concaténé au markup
// des éléments synchrones du Gate (le <form> de recherche, qui a migré ici).
// On NE rend pas le <ComptesContent/> ici (async, non rendable par
// renderToStaticMarkup) : on isole les enfants synchrones du fragment Gate.
async function renderPage(sp: Record<string, string> = {}): Promise<string> {
  const page = (await AdminComptesConsommateursPage({
    searchParams: Promise.resolve(sp),
  })) as ReactElement;
  // En-tête statique (titre) — synchrone dans la coquille page.
  const headerHtml = renderToStaticMarkup(page);
  // Enfants synchrones du Gate (formulaire) — on exclut le composant async.
  const gate = await resolveGate(sp);
  const gateChildren = (gate.props as { children?: unknown }).children;
  const arr = (Array.isArray(gateChildren) ? gateChildren : [gateChildren]).flat();
  const syncChildren = arr.filter(
    (c) =>
      !!c &&
      (typeof c !== "object" ||
        !("type" in (c as object)) ||
        typeof (c as { type?: unknown }).type !== "function"),
  ) as ReactElement[];
  const gateHtml = syncChildren
    .map((c) => renderToStaticMarkup(c))
    .join("");
  return headerHtml + gateHtml;
}

// renderContent : résout le Gate, en extrait l'élément <ComptesContent/> puis
// l'exécute pour obtenir le markup de la liste (fetch + lignes). C'est là que
// vit la logique data.
async function renderContent(sp: Record<string, string> = {}): Promise<string> {
  const gate = await resolveGate(sp);
  // Le Gate retourne un fragment <>form + <ComptesContent/></> : on cherche
  // l'enfant dont le type est une fonction (le composant async Content).
  const gateChildren = (gate.props as { children?: unknown }).children;
  const arr = (Array.isArray(gateChildren) ? gateChildren : [gateChildren]).flat();
  const content = arr.find(
    (c): c is ReactElement =>
      !!c &&
      typeof c === "object" &&
      "type" in c &&
      typeof (c as { type?: unknown }).type === "function",
  );
  if (!content) throw new Error("ComptesContent introuvable dans le Gate");
  const Content = content.type as (
    props: unknown,
  ) => Promise<ReactElement> | ReactElement;
  const resolved = (await Content(content.props)) as ReactElement;
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

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

import AdminInvitationsPage, {
  InvitationsContent,
} from "@/app/(admin)/invitations/page";

// Lot B perf (pattern Gate) : la page synchrone retourne
// <div>en-tête + <Suspense><InvitationsGate/></Suspense></div>. Le Gate (async)
// await + parse le searchParams (status/from/to + cursor), rend les filtres
// (<InvitationsListClient/>) puis délègue à <InvitationsContent/> (async) qui
// fait le fetch service_role + le listing. resolveGate exécute le Gate (on teste
// donc le parsing searchParams réel) et retourne son output (fragment filtres +
// <InvitationsContent/>).
async function resolveGate(pageNode: ReactElement): Promise<ReactElement> {
  // Le <Suspense> est un enfant du <div> racine ; son enfant est le Gate.
  const children = (pageNode.props as { children?: unknown }).children;
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
  if (!gate) throw new Error("InvitationsGate introuvable dans le <Suspense>");
  const Gate = gate.type as (
    props: unknown,
  ) => Promise<ReactElement> | ReactElement;
  return (await Gate(gate.props)) as ReactElement;
}

// resolveContent : exécute le Gate puis y trouve l'élément <InvitationsContent/>
// et l'exécute pour obtenir le markup data (fetch + listing).
async function resolveContent(pageNode: ReactElement): Promise<ReactElement> {
  const gate = await resolveGate(pageNode);
  const props = findByName(gate, "InvitationsContent");
  if (!props) throw new Error("InvitationsContent introuvable dans le Gate");
  return (await InvitationsContent(
    props as Parameters<typeof InvitationsContent>[0],
  )) as ReactElement;
}

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
    const page = (await AdminInvitationsPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    await resolveContent(page);
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
    const page = (await AdminInvitationsPage({
      searchParams: Promise.resolve({ status: "expired" }),
    })) as ReactElement;
    await resolveContent(page);
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
    const page = (await AdminInvitationsPage({
      searchParams: Promise.resolve({ status: "garbage" }),
    })) as ReactElement;
    await resolveContent(page);
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
    const page = (await AdminInvitationsPage({
      searchParams: Promise.resolve({
        before: "2026-05-10T00:00:00Z",
        before_id: "abc",
      }),
    })) as ReactElement;
    await resolveContent(page);
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
    const page = (await AdminInvitationsPage({
      searchParams: Promise.resolve({
        from: "2026-05-01",
        to: "2026-05-12",
      }),
    })) as ReactElement;
    await resolveContent(page);
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

    // <InvitationsListClient/> a migré dans le Gate : on l'exécute d'abord.
    const gate = await resolveGate(node);
    const props = findByName(gate, "InvitationsListClient");
    expect(props).not.toBeNull();
    expect(props?.currentStatus).toBe("revoked");
    expect(props?.currentFrom).toBe("2026-05-01");
    expect(props?.currentTo).toBe("2026-05-12");
  });

  it("propage l'erreur fetcher → message d'erreur dans le contenu", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: "db boom",
    });
    const page = (await AdminInvitationsPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    // Lot B perf : l'erreur est désormais rendue par InvitationsContent (le
    // <p role="alert">), plus par le AdminPageHeader synchrone de la page.
    const content = await resolveContent(page);
    const stringNode = JSON.stringify(content);
    expect(stringNode).toContain("db boom");
  });
});

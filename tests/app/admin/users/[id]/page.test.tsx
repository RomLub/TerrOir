import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// Tests vitest pour le Server Component admin /users/[id] (PR3). 4 fetchs
// mockes (detail + orders + reviews + notifications), on inspecte les props
// passees a UserDetailTabs.

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

const {
  mockFetchDetail,
  mockFetchOrders,
  mockFetchReviews,
  mockFetchNotifications,
  mockNotFound,
} = vi.hoisted(() => ({
  mockFetchDetail: vi.fn(),
  mockFetchOrders: vi.fn(),
  mockFetchReviews: vi.fn(),
  mockFetchNotifications: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/admin/users/fetch", () => ({
  fetchAdminUserDetail: mockFetchDetail,
  fetchAdminUserOrders: mockFetchOrders,
  fetchAdminUserReviews: mockFetchReviews,
  fetchAdminUserNotifications: mockFetchNotifications,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
}));

vi.mock(
  "@/app/(admin)/users/[id]/_components/UserDetailTabs",
  () => ({
    UserDetailTabs: function UserDetailTabs() {
      return null;
    },
  }),
);

import AdminUserDetailPage from "@/app/(admin)/users/[id]/page";

// Lot B perf (pattern Gate) : la page est synchrone et retourne
// <Suspense><UserDetailGate params/></Suspense>. La validation UUID, le notFound()
// et les 4 fetchs vivent désormais dans le Gate (async). resolveGate construit la
// page (synchrone), extrait le <UserDetailGate> du <Suspense> et l'exécute. On
// teste donc le parsing params réel + la chaîne validation/fetch/notFound via le
// Gate (et plus via la page directement).
function resolveGate(params: { id: string }): Promise<ReactElement> {
  const page = AdminUserDetailPage({
    params: Promise.resolve(params),
  }) as ReactElement;
  const gate = (page.props as { children?: ReactElement }).children;
  if (!gate) throw new Error("UserDetailGate introuvable");
  const Gate = gate.type as (
    props: unknown,
  ) => Promise<ReactElement> | ReactElement;
  return Promise.resolve(Gate(gate.props)) as Promise<ReactElement>;
}

const VALID_UUID = "12345678-1234-1234-1234-123456789012";

const FAKE_USER = {
  id: VALID_UUID,
  email: "x@y.fr",
  prenom: "Jean",
  nom: "Dupont",
  telephone: null,
  role: "consumer" as const,
  roles: ["consumer"],
  smsOptin: null,
  createdAt: "2026-01-15T12:00:00Z",
  lastSignInAt: null,
  emailConfirmedAt: null,
  phoneConfirmedAt: null,
};

beforeEach(() => {
  mockFetchDetail.mockReset();
  mockFetchOrders.mockReset();
  mockFetchReviews.mockReset();
  mockFetchNotifications.mockReset();
  mockNotFound.mockClear();
  mockNotFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
});

// Recherche recursive le ReactElement dont le type s'appelle UserDetailTabs.
// Plus robuste que de supposer la position dans l'arbre (le wrapper varie).
function findTabsNode(node: unknown): ReactElement | null {
  if (!node || typeof node !== "object") return null;
  const el = node as Partial<ReactElement>;
  if (el.type && typeof el.type === "function") {
    const name = (el.type as { name?: string }).name ?? "";
    if (name === "UserDetailTabs") return el as ReactElement;
  }
  const children = (el.props as { children?: unknown })?.children;
  if (Array.isArray(children)) {
    for (const c of children) {
      const found = findTabsNode(c);
      if (found) return found;
    }
  } else if (children) {
    return findTabsNode(children);
  }
  return null;
}

describe("Server Component /users/[id]", () => {
  it("id non UUID -> notFound()", async () => {
    await expect(resolveGate({ id: "not-a-uuid" })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mockNotFound).toHaveBeenCalled();
    expect(mockFetchDetail).not.toHaveBeenCalled();
  });

  it("user introuvable -> notFound()", async () => {
    mockFetchDetail.mockResolvedValue({ user: null, error: null });
    await expect(resolveGate({ id: VALID_UUID })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mockFetchDetail).toHaveBeenCalledWith({}, VALID_UUID);
  });

  it("error fetcher detail -> rend AdminPageHeader avec error (pas notFound)", async () => {
    mockFetchDetail.mockResolvedValue({ user: null, error: "db boom" });
    const node = await resolveGate({ id: VALID_UUID });
    expect(node).toBeDefined();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("happy path : fetch parallel 4 helpers + props passes a UserDetailTabs", async () => {
    mockFetchDetail.mockResolvedValue({ user: FAKE_USER, error: null });
    mockFetchOrders.mockResolvedValue({
      orders: [
        {
          id: "o1",
          codeCommande: "ABC",
          createdAt: "2026-02-01T12:00:00Z",
          statut: "completed",
          montantTotal: 10,
          producerName: "Ferme A",
        },
      ],
      error: null,
    });
    mockFetchReviews.mockResolvedValue({
      reviews: [
        {
          id: "r1",
          createdAt: "2026-02-01T12:00:00Z",
          producerName: "Ferme A",
          note: 4,
          statut: "published",
          commentaireExcerpt: "bien",
        },
      ],
      error: null,
    });
    mockFetchNotifications.mockResolvedValue({
      notifications: [
        {
          id: "n1",
          createdAt: "2026-02-01T12:00:00Z",
          channel: "email",
          status: "sent",
          template: "order_confirmed_producer",
          subjectExcerpt: "—",
        },
      ],
      error: null,
    });

    const node = await resolveGate({ id: VALID_UUID });

    expect(mockFetchDetail).toHaveBeenCalledOnce();
    expect(mockFetchOrders).toHaveBeenCalledWith({}, VALID_UUID);
    expect(mockFetchReviews).toHaveBeenCalledWith({}, VALID_UUID);
    expect(mockFetchNotifications).toHaveBeenCalledWith({}, VALID_UUID);

    const tabs = findTabsNode(node);
    expect(tabs).not.toBeNull();
    const props = tabs!.props as Record<string, unknown>;
    expect(props.user).toBe(FAKE_USER);
    expect((props.orders as unknown[]).length).toBe(1);
    expect((props.reviews as unknown[]).length).toBe(1);
    expect((props.notifications as unknown[]).length).toBe(1);
    expect(props.ordersError).toBeNull();
    expect(props.reviewsError).toBeNull();
    expect(props.notificationsError).toBeNull();
  });

  it("erreur sur un onglet (orders) -> err propage en prop, autres OK", async () => {
    mockFetchDetail.mockResolvedValue({ user: FAKE_USER, error: null });
    mockFetchOrders.mockResolvedValue({ orders: [], error: "rls" });
    mockFetchReviews.mockResolvedValue({ reviews: [], error: null });
    mockFetchNotifications.mockResolvedValue({
      notifications: [],
      error: null,
    });
    const node = await resolveGate({ id: VALID_UUID });
    const tabs = findTabsNode(node);
    expect(tabs).not.toBeNull();
    const props = tabs!.props as Record<string, unknown>;
    expect(props.ordersError).toBe("rls");
    expect(props.reviewsError).toBeNull();
    expect(props.notificationsError).toBeNull();
  });
});

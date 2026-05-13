import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

// Tests Server Component /refund-incidents/[id] (PR3 feature/admin-new-
// surfaces). Pattern await Page() + inspection .type / .props sans
// rendu DOM (env=node).

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

const { mockFetchDetail, mockFetchAttempts } = vi.hoisted(() => ({
  mockFetchDetail: vi.fn(),
  mockFetchAttempts: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

vi.mock("@/lib/admin/refund-incidents/fetch", () => ({
  fetchAdminRefundIncidentDetail: mockFetchDetail,
  fetchAdminRefundIncidentAttempts: mockFetchAttempts,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));

// Stub Launcher modal (Client Component). On lui donne un `displayName`
// pour pouvoir le retrouver dans l'arbre ReactElement par
// `type.displayName === 'ResolveIncidentModalLauncher'`. Le stub doit
// être créé via vi.hoisted parce que vi.mock est hoisté avant les const
// top-level (sinon ReferenceError).
const { ResolveIncidentModalLauncherStub } = vi.hoisted(() => {
  const stub = (_props: Record<string, unknown>) => ({
    type: "div",
    key: null,
    ref: null,
    props: { "data-testid": "resolve-launcher-stub" },
  });
  (stub as unknown as { displayName: string }).displayName =
    "ResolveIncidentModalLauncher";
  return { ResolveIncidentModalLauncherStub: stub };
});

vi.mock(
  "@/app/(admin)/refund-incidents/[id]/_components/ResolveIncidentModal",
  () => ({
    ResolveIncidentModalLauncher: ResolveIncidentModalLauncherStub,
  }),
);

import AdminRefundIncidentDetailPage from "@/app/(admin)/refund-incidents/[id]/page";

const INCIDENT_ID = "incident-uuid-1";

const BASE_INCIDENT = {
  id: INCIDENT_ID,
  orderId: "order-1",
  orderCode: "TRR-ABC",
  amountCents: 4250,
  kind: "admin" as const,
  status: "pending" as const,
  retryCount: 1,
  maxRetries: 3,
  lastErrorCode: "card_declined",
  lastErrorMessage: "Card declined",
  firstFailedEventAt: "2026-05-10T10:00:00Z",
  createdAt: "2026-05-10T10:00:00Z",
  resolvedAt: null,
  paymentIntentId: "pi_123",
  consumerId: "user-1",
  blockedReason: null,
  resolutionNote: null,
  updatedAt: "2026-05-10T10:05:00Z",
};

beforeEach(() => {
  mockFetchDetail.mockReset();
  mockFetchAttempts.mockReset().mockResolvedValue({
    attempts: [],
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// DFS dans un arbre ReactElement pour trouver un composant par
// displayName de son type. Le Server Component embarque les Client
// Components dans son arbre avec `type` = la fonction du composant ;
// on vérifie `type.displayName === target` (pattern aligné
// tests/app/(public)/producteurs/[slug]/page.test.tsx).
function findByDisplayName(
  el: unknown,
  displayName: string,
): { type: unknown; props: Record<string, unknown> } | null {
  if (!el) return null;
  if (Array.isArray(el)) {
    for (const c of el) {
      const found = findByDisplayName(c, displayName);
      if (found) return found;
    }
    return null;
  }
  if (typeof el !== "object") return null;
  const candidate = el as { type?: unknown; props?: Record<string, unknown> };
  const typeFn = candidate.type as
    | { displayName?: string; name?: string }
    | string
    | undefined;
  if (
    typeFn &&
    typeof typeFn !== "string" &&
    (typeFn.displayName === displayName || typeFn.name === displayName)
  ) {
    return candidate as { type: unknown; props: Record<string, unknown> };
  }
  const props = candidate.props ?? {};
  for (const value of Object.values(props)) {
    const found = findByDisplayName(value, displayName);
    if (found) return found;
  }
  return null;
}

describe("AdminRefundIncidentDetailPage — fetch + render", () => {
  it("appelle les helpers fetch avec l'id du param", async () => {
    mockFetchDetail.mockResolvedValue({
      incident: BASE_INCIDENT,
      error: null,
    });
    await AdminRefundIncidentDetailPage({
      params: Promise.resolve({ id: INCIDENT_ID }),
    });
    expect(mockFetchDetail).toHaveBeenCalledWith(
      expect.anything(),
      INCIDENT_ID,
    );
    expect(mockFetchAttempts).toHaveBeenCalledWith(
      expect.anything(),
      INCIDENT_ID,
    );
  });

  it("notFound() si incident inexistant", async () => {
    mockFetchDetail.mockResolvedValue({ incident: null, error: null });
    await expect(
      AdminRefundIncidentDetailPage({
        params: Promise.resolve({ id: "unknown" }),
      }),
    ).rejects.toThrow("__NOT_FOUND__");
  });

  it("rend le launcher modal si incident actionnable (status=pending)", async () => {
    mockFetchDetail.mockResolvedValue({
      incident: BASE_INCIDENT,
      error: null,
    });
    const tree = (await AdminRefundIncidentDetailPage({
      params: Promise.resolve({ id: INCIDENT_ID }),
    })) as ReactElement;
    const launcher = findByDisplayName(tree, "ResolveIncidentModalLauncher");
    expect(launcher).not.toBeNull();
    // Le stub place les props passées dans `data-props` pour pouvoir
    // les inspecter (le composant n'est pas appelé, on inspecte la
    // ReactElement avec ses props originales).
    expect(launcher?.props.incidentId).toBe(INCIDENT_ID);
  });

  it("rend le launcher modal si status=retrying (actionnable)", async () => {
    mockFetchDetail.mockResolvedValue({
      incident: { ...BASE_INCIDENT, status: "retrying" },
      error: null,
    });
    const tree = (await AdminRefundIncidentDetailPage({
      params: Promise.resolve({ id: INCIDENT_ID }),
    })) as ReactElement;
    expect(findByDisplayName(tree, "ResolveIncidentModalLauncher")).not.toBeNull();
  });

  it("PAS de launcher modal si status=succeeded (non actionnable)", async () => {
    mockFetchDetail.mockResolvedValue({
      incident: { ...BASE_INCIDENT, status: "succeeded" },
      error: null,
    });
    const tree = (await AdminRefundIncidentDetailPage({
      params: Promise.resolve({ id: INCIDENT_ID }),
    })) as ReactElement;
    expect(findByDisplayName(tree, "ResolveIncidentModalLauncher")).toBeNull();
  });

  it("PAS de launcher modal si status=manually_resolved", async () => {
    mockFetchDetail.mockResolvedValue({
      incident: { ...BASE_INCIDENT, status: "manually_resolved" },
      error: null,
    });
    const tree = (await AdminRefundIncidentDetailPage({
      params: Promise.resolve({ id: INCIDENT_ID }),
    })) as ReactElement;
    expect(findByDisplayName(tree, "ResolveIncidentModalLauncher")).toBeNull();
  });

  it("PAS de launcher modal si status=exhausted", async () => {
    mockFetchDetail.mockResolvedValue({
      incident: { ...BASE_INCIDENT, status: "exhausted" },
      error: null,
    });
    const tree = (await AdminRefundIncidentDetailPage({
      params: Promise.resolve({ id: INCIDENT_ID }),
    })) as ReactElement;
    expect(findByDisplayName(tree, "ResolveIncidentModalLauncher")).toBeNull();
  });

  it("erreur fetch détail → page error sans throw", async () => {
    mockFetchDetail.mockResolvedValue({
      incident: null,
      error: "permission denied",
    });
    const tree = (await AdminRefundIncidentDetailPage({
      params: Promise.resolve({ id: INCIDENT_ID }),
    })) as ReactElement;
    // Ne devrait pas throw notFound — au lieu une page erreur avec
    // AdminPageHeader error prop.
    expect(findByDisplayName(tree, "ResolveIncidentModalLauncher")).toBeNull();
  });
});

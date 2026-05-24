import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

// Tests Server Component /refund-incidents (PR3 feature/admin-new-
// surfaces). Pattern await Page() + inspection .type / .props sans
// rendu DOM (env=node), cohérent tests/app/(public)/producteurs/[slug]/
// page.test.tsx.

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

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

vi.mock("@/lib/admin/refund-incidents/fetch", () => ({
  fetchAdminRefundIncidentsList: mockFetch,
}));

// Stub Client Component pour capturer ses props sans appeler son code
// (qui requiert jsdom et next/navigation).
vi.mock(
  "@/app/(admin)/refund-incidents/_components/RefundIncidentsListClient",
  () => ({
    RefundIncidentsListClient: (props: Record<string, unknown>) => ({
      type: "RefundIncidentsListClient",
      props,
    }),
  }),
);

import AdminRefundIncidentsPage, {
  RefundIncidentsContent,
} from "@/app/(admin)/refund-incidents/page";

// Chantier 5 — la page enveloppe le client dans un Fragment avec
// <RefundsTabNav> (onglets Remboursements).
// Lot B perf (pattern Gate) — le Fragment contient <RefundsTabNav> +
// <Suspense><RefundIncidentsGate searchParams/></Suspense>. Le Gate (async)
// await + parse le searchParams puis retourne <RefundIncidentsContent/> (async)
// qui fait le fetch + retourne le <RefundIncidentsListClient/> final.
// findGate extrait le <RefundIncidentsGate/> du <Suspense> ; getClientProps
// exécute Gate → Content → client pour récupérer les props du client (on teste
// donc le parsing searchParams réel + la propagation des props).
function findGate(
  result: ReactElement & { props: Record<string, unknown> },
): ReactElement {
  const children = (result.props as { children?: unknown }).children;
  const arr = (Array.isArray(children) ? children : [children]).flat();
  // L'enfant <Suspense> porte le <RefundIncidentsGate> dans ses children.
  for (const c of arr) {
    if (!c || typeof c !== "object") continue;
    const el = c as ReactElement & { props?: { children?: unknown } };
    const inner = el.props?.children as
      | (ReactElement & { type?: unknown })
      | undefined;
    if (inner && typeof inner.type === "function") {
      return inner;
    }
  }
  throw new Error("RefundIncidentsGate introuvable dans le Fragment");
}

async function getClientProps(
  result: ReactElement & { props: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const gate = findGate(result);
  const Gate = gate.type as (
    props: unknown,
  ) => Promise<ReactElement> | ReactElement;
  const content = (await Gate(gate.props)) as ReactElement;
  const client = (await RefundIncidentsContent(
    content.props as Parameters<typeof RefundIncidentsContent>[0],
  )) as ReactElement & { props: Record<string, unknown> };
  return client.props;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminRefundIncidentsPage — Server Component", () => {
  it("appelle le helper fetch avec status filter par défaut = pending", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    const page = (await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({}),
    })) as unknown as ReactElement & { props: Record<string, unknown> };
    await getClientProps(page);
    expect(mockFetch).toHaveBeenCalledOnce();
    const opts = mockFetch.mock.calls[0]?.[1] as {
      statusFilter: string;
      cursor: { before: string | null; beforeId: string | null };
    };
    expect(opts.statusFilter).toBe("pending");
    expect(opts.cursor).toEqual({ before: null, beforeId: null });
  });

  it("parse search param ?status=failed → statusFilter=failed", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    const page = (await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({ status: "failed" }),
    })) as unknown as ReactElement & { props: Record<string, unknown> };
    await getClientProps(page);
    const opts = mockFetch.mock.calls[0]?.[1] as { statusFilter: string };
    expect(opts.statusFilter).toBe("failed");
  });

  it("status invalide → fallback pending", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    const page = (await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({ status: "garbage" }),
    })) as unknown as ReactElement & { props: Record<string, unknown> };
    await getClientProps(page);
    const opts = mockFetch.mock.calls[0]?.[1] as { statusFilter: string };
    expect(opts.statusFilter).toBe("pending");
  });

  it("parse cursor before+before_id → passé au fetch", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    const page = (await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({
        before: "2026-05-10T10:00:00Z",
        before_id: "inc-uuid-1",
      }),
    })) as unknown as ReactElement & { props: Record<string, unknown> };
    await getClientProps(page);
    const opts = mockFetch.mock.calls[0]?.[1] as {
      cursor: { before: string | null; beforeId: string | null };
    };
    expect(opts.cursor).toEqual({
      before: "2026-05-10T10:00:00Z",
      beforeId: "inc-uuid-1",
    });
  });

  it("rend le Client Component avec les props attendues", async () => {
    const rows = [
      {
        id: "inc-1",
        orderId: "ord-1",
        orderCode: "TRR-ABC",
        amountCents: 4250,
        kind: "admin" as const,
        status: "pending" as const,
        retryCount: 1,
        maxRetries: 3,
        lastErrorCode: "card_declined",
        lastErrorMessage: null,
        firstFailedEventAt: "2026-05-10T10:00:00Z",
        createdAt: "2026-05-10T10:00:00Z",
        resolvedAt: null,
      },
    ];
    mockFetch.mockResolvedValue({
      rows,
      total: 1,
      nextCursor: null,
      error: null,
    });

    const result = (await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({}),
    })) as unknown as ReactElement & { props: Record<string, unknown> };

    const props = await getClientProps(result);
    expect(props.initialRows).toEqual(rows);
    expect(props.initialTotal).toBe(1);
    expect(props.initialNextCursor).toBeNull();
    expect(props.initialError).toBeNull();
    expect(props.initialStatusFilter).toBe("pending");
    expect(props.isPaginated).toBe(false);
  });

  it("isPaginated=true si cursor présent dans searchParams", async () => {
    mockFetch.mockResolvedValue({
      rows: [],
      total: 0,
      nextCursor: null,
      error: null,
    });
    const result = (await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({
        before: "2026-05-10T10:00:00Z",
        before_id: "inc-1",
      }),
    })) as unknown as ReactElement & { props: Record<string, unknown> };
    expect((await getClientProps(result)).isPaginated).toBe(true);
  });
});

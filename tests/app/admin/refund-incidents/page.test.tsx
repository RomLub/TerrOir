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

import AdminRefundIncidentsPage from "@/app/(admin)/refund-incidents/page";

// Chantier 5 — la page enveloppe désormais le client dans un Fragment avec
// <RefundsTabNav> (onglets Remboursements). On extrait l'élément client
// (celui qui porte initialRows) parmi les enfants du Fragment.
function getClientProps(
  result: ReactElement & { props: Record<string, unknown> },
): Record<string, unknown> {
  const children = (result.props as { children?: unknown }).children;
  const arr = (Array.isArray(children) ? children : [children]).flat();
  const client = arr.find(
    (c): c is ReactElement & { props: Record<string, unknown> } =>
      !!c &&
      typeof c === "object" &&
      "props" in c &&
      !!(c as { props?: Record<string, unknown> }).props &&
      "initialRows" in (c as { props: Record<string, unknown> }).props,
  );
  if (!client) throw new Error("Client element introuvable dans le Fragment");
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
    await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({}),
    });
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
    await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({ status: "failed" }),
    });
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
    await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({ status: "garbage" }),
    });
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
    await AdminRefundIncidentsPage({
      searchParams: Promise.resolve({
        before: "2026-05-10T10:00:00Z",
        before_id: "inc-uuid-1",
      }),
    });
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

    const props = getClientProps(result);
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
    expect(getClientProps(result).isPaginated).toBe(true);
  });
});

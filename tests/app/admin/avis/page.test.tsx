// @vitest-environment jsdom

// Test du Server Component /admin/avis. On mock les helpers fetch pour
// vérifier que la page passe bien les rows au sous-composant client et
// que le header/MetricCard reflètent les counts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
});

const { mockFetchPending, mockFetchPublished } = vi.hoisted(() => ({
  mockFetchPending: vi.fn(),
  mockFetchPublished: vi.fn(),
}));

vi.mock("@/lib/admin/reviews", () => ({
  fetchPendingReviews: mockFetchPending,
  fetchPublishedResponses: mockFetchPublished,
}));

import AdminAvisPage from "@/app/(admin)/avis/page";

beforeEach(() => {
  mockFetchPending.mockReset();
  mockFetchPublished.mockReset();
});

describe("AdminAvisPage (Server Component)", () => {
  it("rend les sections header + 'Avis à modérer' + 'Réponses publiées' (état vide)", async () => {
    mockFetchPending.mockResolvedValue({ rows: [], error: null });
    mockFetchPublished.mockResolvedValue({ rows: [], error: null });

    const ui = await AdminAvisPage();
    render(ui);

    expect(screen.getByRole("heading", { name: /Avis à modérer/i })).toBeDefined();
    expect(screen.getByText(/Réponses producer publiées/i)).toBeDefined();
    expect(screen.getByText(/Aucun avis en attente/i)).toBeDefined();
    expect(screen.getByText(/Aucune réponse producer/i)).toBeDefined();
  });

  it("affiche les rows pending + responses passées par le fetch", async () => {
    mockFetchPending.mockResolvedValue({
      rows: [
        {
          id: "r1",
          author: "Jean D.",
          rating: 4,
          comment: "très bon",
          producer: "Ferme A",
          producerSlug: "ferme-a",
          date: "13 mai 2026",
        },
      ],
      error: null,
    });
    mockFetchPublished.mockResolvedValue({
      rows: [
        {
          id: "r2",
          author: "Marie C.",
          rating: 5,
          comment: "génial",
          producer: "Ferme B",
          producerSlug: "ferme-b",
          date: "10 mai 2026",
          response: "Merci !",
          responseAt: "11 mai 2026",
          responseStatus: "published" as const,
        },
      ],
      error: null,
    });

    const ui = await AdminAvisPage();
    render(ui);

    expect(screen.getByText("Jean D.")).toBeDefined();
    expect(screen.getByText(/très bon/)).toBeDefined();
    expect(screen.getByText("Marie C.")).toBeDefined();
    expect(screen.getByText(/Merci !/)).toBeDefined();
  });

  it("propage l'erreur de fetch dans le header", async () => {
    mockFetchPending.mockResolvedValue({ rows: [], error: "DB down" });
    mockFetchPublished.mockResolvedValue({ rows: [], error: null });

    const ui = await AdminAvisPage();
    render(ui);

    expect(screen.getByText(/DB down/)).toBeDefined();
  });
});

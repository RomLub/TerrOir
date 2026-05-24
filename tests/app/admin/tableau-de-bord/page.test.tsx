import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminDashboardData } from "@/lib/admin/dashboard/types";

// Tests page (admin)/tableau-de-bord (chantier 2 refonte) — on n'effectue pas
// un render React complet d'un Server Component : on await Page(...) puis on
// asserte sur le markup statique. Chemin sous tests/app/admin/... (sans
// parenthèses) pour éviter le bug Glob/grep Windows sur les parenthèses.

const mockFetch = vi.fn(async (): Promise<AdminDashboardData | null> => null);

vi.mock("@/lib/admin/dashboard/fetch", () => ({
  // La page appelle fetchAdminDashboard(period) ; le mock ignore l'arg.
  fetchAdminDashboard: (_period?: string) => mockFetch(),
}));

import AdminDashboardPage from "@/app/(admin)/tableau-de-bord/page";

const SAMPLE_DATA: AdminDashboardData = {
  period: {
    orders_count: 6,
    revenue_cents: 12345,
    active_consumers: 3,
    active_producers: 2,
  },
  cockpit: {
    refunds_pending_count: 3,
    disputes_open_count: 0,
    reviews_pending_count: 2,
    producers_pending_validation_count: 1,
    refund_incidents_count: 0,
    invitations_expired_count: 8,
    publications_pending_count: 2,
    bio_pending_count: 1,
  },
  conversion_30d: {
    invitations_sent: 10,
    onboardings_completed: 4,
    rate_pct: 40.0,
  },
  recent_events: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      event_type: "order_created",
      user_id: "u1",
      metadata: { order_id: "abcdefgh-1111-2222-3333-444444444444" },
      created_at: "2026-05-13T10:00:00Z",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      event_type: "account_login_magic_link",
      user_id: null,
      metadata: { email_masked: "te***@gmail.com" },
      created_at: "2026-05-13T11:00:00Z",
    },
  ],
};

// Lot B perf : la page retourne désormais <Suspense><AdminDashboardContent/></Suspense>.
// renderToStaticMarkup ne résout pas les Server Components async sous Suspense
// (il rendrait le skeleton). On extrait donc l'enfant <AdminDashboardContent>
// du <Suspense> rendu par la page (on teste toujours le parsing period réel),
// puis on l'exécute pour obtenir le markup data.
async function renderPage(period?: string): Promise<string> {
  const page = (await AdminDashboardPage({
    searchParams: Promise.resolve(period ? { period } : {}),
  })) as ReactElement;
  const content = (page.props as { children?: ReactElement }).children;
  if (!content) throw new Error("Suspense child (content) introuvable");
  const Comp = content.type as (
    props: unknown,
  ) => Promise<ReactElement> | ReactElement;
  const resolved = (await Comp(content.props)) as ReactElement;
  return renderToStaticMarkup(resolved);
}

describe("AdminDashboardPage (chantier 2)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("état d'erreur lisible quand le RPC retourne null", async () => {
    mockFetch.mockResolvedValue(null);
    const html = await renderPage();
    expect(html).toContain("Tableau de bord");
    expect(html).toMatch(/Impossible de charger/);
  });

  it("Zone 1 — bandeau période : sélecteur 4 périodes + 4 KPIs", async () => {
    mockFetch.mockResolvedValue(SAMPLE_DATA);
    const html = await renderPage();
    expect(html).toContain("Activité sur la période");
    // Sélecteur
    for (const label of ["Aujourd", "Cette semaine", "Ce mois-ci", "Cette année"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('href="/tableau-de-bord?period=week"');
    expect(html).toContain('href="/tableau-de-bord?period=month"');
    expect(html).toContain('href="/tableau-de-bord?period=year"');
    // 4 KPIs
    expect(html).toContain("Commandes");
    expect(html).toContain("affaires"); // "Chiffre d'affaires" (apostrophe échappée &#x27; par React)
    expect(html).toContain("Consommateurs actifs");
    expect(html).toContain("Producteurs actifs");
    expect(html).toContain(">6<"); // orders_count
    expect(html).toMatch(/123,45[\s ]€/); // revenue_cents
    expect(html).toContain(">3<"); // active_consumers
    expect(html).toContain(">2<"); // active_producers
  });

  it("période sélectionnée stylée active (period=year)", async () => {
    mockFetch.mockResolvedValue(SAMPLE_DATA);
    const html = await renderPage("year");
    // L'onglet "Cette année" porte la classe active (bg vert).
    expect(html).toMatch(
      /href="\/tableau-de-bord\?period=year"[^>]*bg-green-700|bg-green-700[^>]*>Cette année/,
    );
  });

  it("Zone 2 — cockpit : 8 cartes FR, comptes affichés", async () => {
    mockFetch.mockResolvedValue(SAMPLE_DATA);
    const html = await renderPage();
    expect(html).toContain("Remboursements en attente");
    expect(html).toContain("Litiges ouverts");
    expect(html).toContain("Avis à modérer");
    expect(html).toContain("Producteurs à valider");
    expect(html).toContain("Publications à valider");
    expect(html).toContain("Certifications bio à valider");
    expect(html).toContain("Incidents de remboursement");
    expect(html).toContain("Invitations expirées");
    expect(html).not.toContain("Refunds");
  });

  it("cockpit : toutes les cartes cliquables (Litiges branché au chantier 8 → plus de carte en attente)", async () => {
    mockFetch.mockResolvedValue(SAMPLE_DATA);
    const html = await renderPage();
    expect(html).toContain('href="/refunds/pending"');
    expect(html).toContain('href="/avis"');
    expect(html).toContain('href="/gestion-producteurs?status=pending"');
    expect(html).toContain('href="/refund-incidents"');
    expect(html).toContain('href="/invitations"');
    // Chantier 8 : « Litiges ouverts » est désormais branché sur /litiges.
    expect(html).toContain('href="/litiges"');
    // Plus aucune carte « Page à venir » (toutes branchées).
    expect(html).not.toContain('title="Page à venir"');
  });

  it("opacity-50 sur les cartes cockpit à 0", async () => {
    mockFetch.mockResolvedValue(SAMPLE_DATA);
    const html = await renderPage();
    expect(html).toContain("opacity-50"); // disputes_open + refund_incidents = 0
  });

  it("Zone 3 — conversion invitations 30j", async () => {
    mockFetch.mockResolvedValue(SAMPLE_DATA);
    const html = await renderPage();
    expect(html).toContain("Conversion invitations");
    expect(html).toContain(">10<");
    expect(html).toContain(">4<");
    expect(html).toMatch(/40,0[\s ]%/);
  });

  it("conversion : '—' quand invitations_sent = 0", async () => {
    mockFetch.mockResolvedValue({
      ...SAMPLE_DATA,
      conversion_30d: {
        invitations_sent: 0,
        onboardings_completed: 0,
        rate_pct: null,
      },
    });
    const html = await renderPage();
    expect(html).toContain("Aucune invitation sur la fenêtre");
    expect(html).not.toMatch(/0,0[\s ]%/);
  });

  it("Zone 4 — activité récente, lignes cliquables vers /audit-logs", async () => {
    mockFetch.mockResolvedValue(SAMPLE_DATA);
    const html = await renderPage();
    expect(html).toContain("Activité récente");
    expect(html).toContain('href="/audit-logs?event_type=order_created"');
    expect(html).toContain('href="/audit-logs?event_type=account_login_magic_link"');
    expect(html).toContain("te***@gmail.com");
    expect(html).toContain("Commande abcdefgh");
  });

  it("placeholder quand recent_events vide", async () => {
    mockFetch.mockResolvedValue({ ...SAMPLE_DATA, recent_events: [] });
    const html = await renderPage();
    expect(html).toContain("Aucune activité récente");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests unitaires sur fetchAdminDashboard — mock du client supabase admin
// pour valider :
//   - le shape retourné (cast direct du JSONB)
//   - le fail-safe (RPC error → null + console.error, pas de throw)

const mockRpc = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: mockRpc,
  }),
}));

describe("fetchAdminDashboard", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("retourne les données du RPC quand pas d'erreur", async () => {
    const sampleData = {
      cockpit: {
        refunds_pending_count: 2,
        disputes_open_count: 0,
        reviews_pending_count: 1,
        producers_pending_validation_count: 3,
        refund_incidents_count: 0,
        invitations_expired_count: 5,
      },
      business: {
        orders_today_count: 4,
        revenue_today_cents: 12500,
        new_users_today_count: 2,
        orders_7d_count: 30,
        revenue_7d_cents: 95000,
        completion_rate_7d: 87.5,
        active_producers_7d: 5,
        total_producers: 12,
        invitation_conversion_30d: {
          invitations_sent: 10,
          onboardings_completed: 4,
          rate_pct: 40,
        },
      },
      recent_events: [],
    };
    mockRpc.mockResolvedValue({ data: sampleData, error: null });

    const { fetchAdminDashboard } = await import(
      "@/lib/admin/dashboard/fetch"
    );
    const result = await fetchAdminDashboard();
    expect(result).toEqual(sampleData);
    expect(mockRpc).toHaveBeenCalledWith("get_admin_dashboard", {
      p_period: "today",
    });
  });

  it("retourne null + log console.error si le RPC échoue", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "DB down", code: "PGRST500" },
    });

    const { fetchAdminDashboard } = await import(
      "@/lib/admin/dashboard/fetch"
    );
    const result = await fetchAdminDashboard();
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("ADMIN_DASHBOARD_RPC_ERR"),
    );
  });

  it("ne throw pas même si le RPC retourne data:null sans erreur", async () => {
    // Cas limite : Supabase retourne data=null, error=null (table vide ou
    // RPC custom retournant explicitement null). On accepte et on cast —
    // l'appelant doit gérer.
    mockRpc.mockResolvedValue({ data: null, error: null });

    const { fetchAdminDashboard } = await import(
      "@/lib/admin/dashboard/fetch"
    );
    const result = await fetchAdminDashboard();
    expect(result).toBeNull();
  });
});

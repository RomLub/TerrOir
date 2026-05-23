import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdminAccounts } from "@/lib/admin/admins/fetch";

// Test fetchAdminAccounts (chantier 6) : mapping raw→AdminAccountRow.

function makeAdmin(data: unknown, error: unknown = null): SupabaseClient {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.order = () => Promise.resolve({ data, error });
  return { from: () => b } as unknown as SupabaseClient;
}

describe("fetchAdminAccounts", () => {
  it("mappe fullName, privilege, suspended", async () => {
    const res = await fetchAdminAccounts(
      makeAdmin([
        {
          id: "a1",
          email: "a@x.fr",
          prenom: "Romain",
          nom: "Lubin",
          admin_privilege: "super_admin",
          suspended_at: null,
          created_at: "2026-04-21T11:00:00Z",
        },
        {
          id: "a2",
          email: "b@x.fr",
          prenom: null,
          nom: null,
          admin_privilege: "standard",
          suspended_at: "2026-05-20T10:00:00Z",
          created_at: "2026-05-01T11:00:00Z",
        },
      ]),
    );
    expect(res.error).toBeNull();
    expect(res.rows[0]).toMatchObject({
      id: "a1",
      fullName: "Romain Lubin",
      privilege: "super_admin",
      suspended: false,
    });
    expect(res.rows[1]).toMatchObject({
      fullName: "—",
      privilege: "standard",
      suspended: true,
    });
  });

  it("erreur DB → rows vide + message", async () => {
    const res = await fetchAdminAccounts(makeAdmin(null, { message: "boom" }));
    expect(res.rows).toEqual([]);
    expect(res.error).toBe("boom");
  });
});

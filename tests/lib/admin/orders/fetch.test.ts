import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdminOrdersList } from "@/lib/admin/orders/fetch";

// Test fetchAdminOrdersList (chantier 5 — factorisation suivi-commandes) :
// mapping raw→AdminOrder + normalisation jointures objet/array + fallback
// client/producer.

type Resp = { data?: unknown; error?: unknown };

function makeAdmin(resp: Resp): SupabaseClient {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.order = () => b;
  b.limit = () => Promise.resolve(resp);
  return { from: () => b } as unknown as SupabaseClient;
}

const RAW = {
  id: "o1",
  code_commande: "TRR-001",
  created_at: "2026-05-20T10:00:00Z",
  statut: "completed",
  closure_reason: null,
  montant_total: 23.4,
  date_retrait: "2026-05-22",
  heure_retrait: null,
  consumer: { prenom: "Jean", nom: "Dupont" },
  producer: [{ nom_exploitation: "Ferme A" }],
  slots: { starts_at: "2026-05-22T09:00:00Z", ends_at: "2026-05-22T11:00:00Z" },
};

describe("fetchAdminOrdersList", () => {
  it("mappe client/producer/total/status + slot_label string", async () => {
    const res = await fetchAdminOrdersList(makeAdmin({ data: [RAW], error: null }));
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "o1",
      code_commande: "TRR-001",
      client: "Jean Dupont",
      producer: "Ferme A",
      total: 23.4,
      status: "completed",
    });
    expect(typeof res.rows[0].slot_label).toBe("string");
  });

  it("fallback client='Client' / producer='—' quand jointures vides", async () => {
    const raw = { ...RAW, consumer: null, producer: null };
    const res = await fetchAdminOrdersList(makeAdmin({ data: [raw], error: null }));
    expect(res.rows[0].client).toBe("Client");
    expect(res.rows[0].producer).toBe("—");
  });

  it("montant_total null → total 0", async () => {
    const raw = { ...RAW, montant_total: null };
    const res = await fetchAdminOrdersList(makeAdmin({ data: [raw], error: null }));
    expect(res.rows[0].total).toBe(0);
  });

  it("erreur DB → rows vide + message", async () => {
    const res = await fetchAdminOrdersList(
      makeAdmin({ data: null, error: { message: "boom" } }),
    );
    expect(res.rows).toEqual([]);
    expect(res.error).toBe("boom");
  });
});

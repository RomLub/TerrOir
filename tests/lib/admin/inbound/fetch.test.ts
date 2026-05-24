import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchInboundEmails,
  fetchInboundUnreadCounts,
} from "@/lib/admin/inbound/fetch";

type Resp = { data?: unknown; error?: unknown };
function makeAdmin(resp: Resp): SupabaseClient {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.is = () => b;
  b.order = () => b;
  b.limit = () => Promise.resolve(resp);
  return { from: () => b } as unknown as SupabaseClient;
}

describe("fetchInboundEmails", () => {
  it("mappe raw → InboundEmailRow", async () => {
    const raw = {
      id: "m1",
      from_email: "c@x.fr",
      from_name: "Client",
      to_email: "contact@x.fr",
      subject: "Bonjour",
      body_text: "Texte",
      body_html: null,
      received_at: "2026-05-24T10:00:00Z",
      tag: "consommateur",
      lookup_user_id: "u1",
      lookup_lead_id: null,
      read_at: null,
      replied_at: null,
    };
    const res = await fetchInboundEmails(makeAdmin({ data: [raw], error: null }), "consommateur");
    expect(res.error).toBeNull();
    expect(res.rows[0]).toMatchObject({
      id: "m1",
      fromEmail: "c@x.fr",
      subject: "Bonjour",
      tag: "consommateur",
      lookupUserId: "u1",
    });
  });

  it("erreur DB → rows vide + message", async () => {
    const res = await fetchInboundEmails(makeAdmin({ data: null, error: { message: "boom" } }), "public");
    expect(res.rows).toEqual([]);
    expect(res.error).toBe("boom");
  });
});

describe("fetchInboundUnreadCounts", () => {
  it("agrège les non-lus par tag", async () => {
    const counts = await fetchInboundUnreadCounts(
      makeAdmin({
        data: [{ tag: "producteur" }, { tag: "producteur" }, { tag: "public" }],
        error: null,
      }),
    );
    expect(counts).toEqual({ producteur: 2, consommateur: 0, public: 1 });
  });
});

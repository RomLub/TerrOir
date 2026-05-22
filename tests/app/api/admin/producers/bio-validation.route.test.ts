import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type SessionUser = { id: string; email: string | null; isAdmin: boolean } | null;
let sessionUser: SessionUser;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => sessionUser }));

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  update: vi.fn(),
  log: vi.fn(),
  revalCard: vi.fn(),
  revalSearch: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => h.maybeSingle() }) }),
      update: () => ({ eq: () => Promise.resolve(h.update()) }),
    }),
  }),
}));
vi.mock("@/lib/audit-logs/log-producers-admin-event", () => ({
  logProducersAdminEvent: h.log,
}));
vi.mock("@/lib/stats/revalidate", () => ({
  revalidateProducerCard: h.revalCard,
  revalidateProducersSearch: h.revalSearch,
}));

import { PATCH } from "@/app/api/admin/producers/[id]/bio-validation/route";

const req = (body: unknown): Request =>
  ({ json: async () => body }) as unknown as Request;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  sessionUser = { id: "admin-1", email: "a@x.fr", isAdmin: true };
  h.maybeSingle.mockReset().mockResolvedValue({
    data: { id: "p1", slug: "ferme", nom_exploitation: "Ferme", bio: true, bio_certificate_number: "FRBIO-1" },
    error: null,
  });
  h.update.mockReset().mockReturnValue({ error: null });
  h.log.mockReset().mockResolvedValue(undefined);
  h.revalCard.mockReset().mockResolvedValue(undefined);
  h.revalSearch.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("PATCH /api/admin/producers/[id]/bio-validation", () => {
  it("non admin → 403", async () => {
    sessionUser = null;
    const res = await PATCH(req({ validate: true }), ctx("p1"));
    expect(res.status).toBe(403);
  });

  it("body invalide → 400", async () => {
    const res = await PATCH(req({}), ctx("p1"));
    expect(res.status).toBe(400);
  });

  it("producteur introuvable → 404", async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await PATCH(req({ validate: true }), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("validate=true mais bio non déclaré → 422", async () => {
    h.maybeSingle.mockResolvedValue({
      data: { id: "p1", slug: "ferme", nom_exploitation: "Ferme", bio: false, bio_certificate_number: null },
      error: null,
    });
    const res = await PATCH(req({ validate: true }), ctx("p1"));
    expect(res.status).toBe(422);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("validate=true → 200 + audit validated:true + revalidation", async () => {
    const res = await PATCH(req({ validate: true }), ctx("p1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bio_validated_at: string | null };
    expect(body.bio_validated_at).not.toBeNull();
    expect(h.log.mock.calls[0][0].eventType).toBe("admin_producer_bio_validated");
    expect(h.log.mock.calls[0][0].metadata).toMatchObject({ validated: true });
    expect(h.revalCard).toHaveBeenCalled();
    expect(h.revalSearch).toHaveBeenCalled();
  });

  it("validate=false → 200 + bio_validated_at null + audit validated:false", async () => {
    const res = await PATCH(req({ validate: false }), ctx("p1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bio_validated_at: string | null };
    expect(body.bio_validated_at).toBeNull();
    expect(h.log.mock.calls[0][0].metadata).toMatchObject({ validated: false });
  });
});

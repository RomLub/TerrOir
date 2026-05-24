import { describe, it, expect, vi, beforeEach } from "vitest";

// Tests route POST /api/admin/disputes/[id]/evidence (chantier 8) : gate admin,
// normalisation du body, mapping résultat. La logique est dans
// submitDisputeEvidence (mockée ici).

const { sessionMock, submitMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  submitMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: sessionMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/admin/disputes/submit-evidence", () => ({
  submitDisputeEvidence: submitMock,
}));

import { POST } from "@/app/api/admin/disputes/[id]/evidence/route";

function req(body?: unknown): Request {
  return new Request("http://admin.local/api/admin/disputes/d1/evidence", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: "d1" }) };

beforeEach(() => {
  sessionMock.mockReset();
  submitMock.mockReset();
});

describe("POST /api/admin/disputes/[id]/evidence", () => {
  it("non-admin → 403, op non appelée", async () => {
    sessionMock.mockResolvedValue(null);
    const res = await POST(req({ evidence: {}, submit: false }), params);
    expect(res.status).toBe(403);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("admin + body valide → appelle submitDisputeEvidence (evidence normalisée) + 200", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true });
    submitMock.mockResolvedValue({ ok: true });
    const res = await POST(
      req({ evidence: { uncategorized_text: "preuve", inconnu: "x" }, submit: true }),
      params,
    );
    expect(res.status).toBe(200);
    const [, actor, id, evidence, submit] = submitMock.mock.calls[0];
    expect(actor).toBe("a1");
    expect(id).toBe("d1");
    expect(submit).toBe(true);
    // Champ inconnu ignoré, champs connus présents.
    expect(evidence.uncategorized_text).toBe("preuve");
    expect(evidence).not.toHaveProperty("inconnu");
    expect(evidence.product_description).toBe("");
  });

  it("op refuse → 400 + message", async () => {
    sessionMock.mockResolvedValue({ id: "a1", isAdmin: true });
    submitMock.mockResolvedValue({ ok: false, error: "Ce litige n'accepte plus de preuves." });
    const res = await POST(req({ evidence: {}, submit: false }), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/n'accepte plus/);
  });
});

// Tests vitest pour POST /api/producer-interests.
//
// Stratégie : mock du helper upsertProducerInterest +
// createSupabaseAdminClient. La route délègue toute la logique DB au
// helper (testé séparément), donc les tests route se concentrent sur :
// - validation Zod (400 sur input invalide)
// - propagation de la réponse helper (200 created/updated, 500 error)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { mockUpsert, mockClientHolder } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockClientHolder: { current: null as SupabaseClient | null },
}));

vi.mock("@/lib/producer-interests/upsert-interest", () => ({
  upsertProducerInterest: mockUpsert,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockClientHolder.current!,
}));

import { POST } from "@/app/api/producer-interests/route";

const VALID_BODY = {
  prenom: "Jean",
  nom: "Dupont",
  email: "jean.dupont@example.com",
  telephone: "0612345678",
  nom_exploitation: "Ferme du Pré",
  commune: "Le Mans",
  message: "Je veux rejoindre",
  consent: true,
};

function buildRequest(body: unknown): Request {
  return new Request("http://localhost/api/producer-interests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockUpsert.mockReset();
  mockClientHolder.current = {} as SupabaseClient;
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/producer-interests — validation Zod", () => {
  it("body absent → 400", async () => {
    const req = new Request("http://localhost/api/producer-interests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("email invalide → 400", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, email: "not-email" }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("prenom vide → 400", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, prenom: "  " }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("nom_exploitation manquant → 400", async () => {
    const { nom_exploitation, ...partial } = VALID_BODY;
    void nom_exploitation;
    const res = await POST(buildRequest(partial));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("message optionnel : absent → 200 et message=null transmis au helper", async () => {
    mockUpsert.mockResolvedValue({
      ok: true,
      data: { id: "row-1", status: "created" },
    });
    const { message, ...partial } = VALID_BODY;
    void message;
    const res = await POST(buildRequest(partial));
    expect(res.status).toBe(200);
    const callInput = mockUpsert.mock.calls[0][1];
    expect(callInput.message).toBeNull();
  });

  it("message vide après trim → message=null transmis au helper", async () => {
    mockUpsert.mockResolvedValue({
      ok: true,
      data: { id: "row-1", status: "created" },
    });
    const res = await POST(buildRequest({ ...VALID_BODY, message: "   " }));
    expect(res.status).toBe(200);
    const callInput = mockUpsert.mock.calls[0][1];
    expect(callInput.message).toBeNull();
  });
});

describe("POST /api/producer-interests — propagation helper", () => {
  it("helper ok status='created' → 200 { status: 'created' }", async () => {
    mockUpsert.mockResolvedValue({
      ok: true,
      data: { id: "row-1", status: "created" },
    });
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("created");
  });

  it("helper ok status='updated' (re-submit même email) → 200 { status: 'updated' }", async () => {
    mockUpsert.mockResolvedValue({
      ok: true,
      data: { id: "row-1", status: "updated" },
    });
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("updated");
  });

  it("helper ok:false → 500 + log [PRODUCER_INTEREST_API_*] avec email masqué", async () => {
    mockUpsert.mockResolvedValue({
      ok: false,
      error: "connection lost",
    });
    const res = await POST(buildRequest(VALID_BODY));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Erreur serveur");
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logArg = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logArg).toContain("[PRODUCER_INTEREST_API_UPSERT_ERROR]");
    // Email masqué : "ja***@example.com" pas "jean.dupont"
    expect(logArg).toContain("***@example.com");
    expect(logArg).not.toContain("jean.dupont");
  });
});

describe("POST /api/producer-interests — F-038 consent + honeypot", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("consent absent → 400 + helper jamais appelé", async () => {
    const { consent, ...withoutConsent } = VALID_BODY;
    const res = await POST(buildRequest(withoutConsent));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("consent=false → 400 + helper jamais appelé", async () => {
    const res = await POST(buildRequest({ ...VALID_BODY, consent: false }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("honeypot rempli → 200 fake-success + helper jamais appelé + log warn", async () => {
    const res = await POST(
      buildRequest({ ...VALID_BODY, website: "https://spam-bot.example" }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("created");
    expect(mockUpsert).not.toHaveBeenCalled();
    // Log forensique observable
    expect(consoleWarnSpy).toHaveBeenCalled();
    const logArg = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(logArg).toContain("[PRODUCER_INTEREST_HONEYPOT_HIT]");
  });

  it("honeypot vide explicite → 200 nominal (helper appelé)", async () => {
    mockUpsert.mockResolvedValue({
      ok: true,
      data: { id: "row-1", status: "created" },
    });
    const res = await POST(buildRequest({ ...VALID_BODY, website: "" }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});

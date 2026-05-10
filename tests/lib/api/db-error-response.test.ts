import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dbErrorResponse } from "@/lib/api/db-error-response";

// F-029 (audit pré-launch 2026-05-10) — tests du helper dbErrorResponse.
// Contrat :
//   1. Retourne toujours { error: "Internal database error" } + status 500.
//   2. Le message Postgres brut N'EST JAMAIS exposé côté JSON response.
//   3. Le message Postgres est loggé côté serveur avec préfixe [logTag].
//   4. Le code Postgres + extra context sont loggés (mais pas dans la response).

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dbErrorResponse — réponse JSON", () => {
  it("retourne status 500 + { error: 'Internal database error' } (PostgrestError)", async () => {
    const pgError = {
      message: "duplicate key value violates unique constraint",
      code: "23505",
      details: 'Key (email)=(x@y.com) already exists.',
      hint: null,
      name: "PostgrestError",
    };
    const res = dbErrorResponse(pgError, "TEST_TAG");
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Internal database error");
    // Garde-fou stricte : aucun fragment du message brut dans la response.
    expect(json.error).not.toContain("duplicate");
    expect(json.error).not.toContain("23505");
    expect(json.error).not.toContain("email");
  });

  it("retourne status 500 avec error null (defensive)", async () => {
    const res = dbErrorResponse(null, "TEST_TAG_NULL");
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Internal database error");
  });

  it("retourne status 500 avec error undefined", async () => {
    const res = dbErrorResponse(undefined, "TEST_TAG_UNDEFINED");
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Internal database error");
  });

  it("retourne status 500 avec Error standard JS", async () => {
    const err = new Error("network down");
    const res = dbErrorResponse(err, "TEST_NETWORK");
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Internal database error");
    expect(json.error).not.toContain("network");
  });
});

describe("dbErrorResponse — log serveur", () => {
  it("log [TAG] db_error code=... message=... avec message brut", () => {
    const pgError = {
      message: "relation 'orders' does not exist",
      code: "42P01",
    };
    dbErrorResponse(pgError, "PROD_LEAK_TAG");
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const logArg = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logArg).toContain("[PROD_LEAK_TAG]");
    expect(logArg).toContain("db_error");
    expect(logArg).toContain("code=42P01");
    expect(logArg).toContain("relation 'orders' does not exist");
  });

  it("log code=none quand l'erreur n'a pas de code", () => {
    const err = new Error("plain js error");
    dbErrorResponse(err, "NO_CODE_TAG");
    const logArg = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logArg).toContain("code=none");
    expect(logArg).toContain("plain js error");
  });

  it("log extraContext key=value formatés", () => {
    dbErrorResponse(
      { message: "fail", code: "X1" },
      "WITH_CTX",
      { order_id: "abc-123", user_id: 42 },
    );
    const logArg = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logArg).toContain("order_id=abc-123");
    expect(logArg).toContain("user_id=42");
  });

  it("log : extraContext null/undefined valeurs filtrées", () => {
    dbErrorResponse(
      { message: "fail" },
      "WITH_NULL_CTX",
      { keep: "yes", skip_null: null, skip_undef: undefined },
    );
    const logArg = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logArg).toContain("keep=yes");
    expect(logArg).not.toContain("skip_null=");
    expect(logArg).not.toContain("skip_undef=");
  });
});

describe("dbErrorResponse — leak-prevention strict", () => {
  it("response JSON ne fuit JAMAIS le code Postgres", async () => {
    const pgError = {
      message: "permission denied for table secret_table",
      code: "42501",
    };
    const res = dbErrorResponse(pgError, "RLS_LEAK");
    const json = await res.json();
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("42501");
    expect(serialized).not.toContain("secret_table");
    expect(serialized).not.toContain("permission");
  });

  it("response JSON ne fuit pas le extraContext (pour éviter id-spoofing inverse)", async () => {
    const pgError = { message: "constraint violation", code: "23502" };
    const res = dbErrorResponse(pgError, "CTX_LEAK", {
      user_id: "user-secret-uuid",
      order_id: "order-secret-uuid",
    });
    const json = await res.json();
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("user-secret-uuid");
    expect(serialized).not.toContain("order-secret-uuid");
  });
});

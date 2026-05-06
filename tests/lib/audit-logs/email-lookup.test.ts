import { describe, it, expect, vi, beforeEach } from "vitest";

// T-110 : .ilike() pour case-insensitive lookup côté src.
const { mockMaybeSingle, mockIlike, mockSelect, mockFrom } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockIlike = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ ilike: mockIlike }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  return { mockMaybeSingle, mockIlike, mockSelect, mockFrom };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mockFrom }),
}));

import {
  lookupUserIdByEmail,
  maskEmail,
  normalizeEmail,
  SENTINEL_NOT_FOUND_USER_ID,
} from "@/lib/audit-logs/email-lookup";

describe("normalizeEmail", () => {
  it("trim + lowercase un email valide", () => {
    expect(normalizeEmail("  Lubin.Rom@Gmail.COM  ")).toBe(
      "lubin.rom@gmail.com",
    );
  });

  it("retourne null pour input vide / blank", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
  });

  it("retourne null pour format invalide", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("@no-local.fr")).toBeNull();
    expect(normalizeEmail("missing-at.fr")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
  });

  it("retourne null si > 320 chars (RFC 5321)", () => {
    const huge = "a".repeat(320) + "@b.fr"; // 325 chars
    expect(huge.length).toBeGreaterThan(320);
    expect(normalizeEmail(huge)).toBeNull();
  });
});

describe("maskEmail", () => {
  it("garde la 1re lettre du local + tout le domaine", () => {
    expect(maskEmail("lubin.rom@gmail.com")).toBe("l***@gmail.com");
    expect(maskEmail("a@b.fr")).toBe("a***@b.fr");
  });

  it("normalise (trim + lowercase) avant de masquer", () => {
    expect(maskEmail("  Bob@Example.COM  ")).toBe("b***@example.com");
  });

  it("retourne *** pour input dégénéré (sans @ utile)", () => {
    expect(maskEmail("nobody")).toBe("***");
    expect(maskEmail("@nodomain")).toBe("***");
    expect(maskEmail("local@")).toBe("***");
    expect(maskEmail("")).toBe("***");
  });
});

describe("lookupUserIdByEmail", () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset();
    mockIlike.mockClear();
    mockSelect.mockClear();
    mockFrom.mockClear();
  });

  it("user trouvé → renvoie son id avec found=true", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "11111111-1111-1111-1111-111111111111" },
      error: null,
    });
    const r = await lookupUserIdByEmail("lubin.rom@gmail.com");
    expect(r).toEqual({
      userId: "11111111-1111-1111-1111-111111111111",
      found: true,
    });
    expect(mockIlike).toHaveBeenCalledWith("email", "lubin.rom@gmail.com");
  });

  it("user non trouvé → renvoie sentinel avec found=false", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const r = await lookupUserIdByEmail("ghost@nowhere.fr");
    expect(r).toEqual({
      userId: SENTINEL_NOT_FOUND_USER_ID,
      found: false,
    });
  });

  it("erreur DB → renvoie sentinel avec found=false (pas de leak)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    const r = await lookupUserIdByEmail("anyone@example.com");
    expect(r).toEqual({
      userId: SENTINEL_NOT_FOUND_USER_ID,
      found: false,
    });
  });

  it("email invalide → renvoie sentinel SANS toucher la DB", async () => {
    const r = await lookupUserIdByEmail("not-an-email");
    expect(r).toEqual({
      userId: SENTINEL_NOT_FOUND_USER_ID,
      found: false,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

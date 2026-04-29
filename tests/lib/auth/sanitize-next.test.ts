// Tests vitest pour sanitizeNext (lib/auth/sanitize-next.ts).
//
// Couvre la matrice exhaustive vector attack T-314 audit auth :
// - URLs absolues (bloqué via not_relative)
// - Protocol-relative // et /\ (gap principal fixé)
// - Schemes dangereux javascript / data / file / vbscript
// - Control chars CRLF / null / tab (anti log forging)
// - Edges null / undefined / "" / non-string / whitespace prefix
//
// Vérifie aussi le format de logging forensique greppable Vercel
// SANITIZE_NEXT_REJECTED reason=… raw_length=… (cohérent T-318/T-309/T-317).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sanitizeNext } from "@/lib/auth/sanitize-next";

describe("sanitizeNext", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("paths relatifs valides (acceptés)", () => {
    it("/ → /", () => {
      expect(sanitizeNext("/")).toBe("/");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("/compte → /compte", () => {
      expect(sanitizeNext("/compte")).toBe("/compte");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("/compte/commandes → /compte/commandes", () => {
      expect(sanitizeNext("/compte/commandes")).toBe("/compte/commandes");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("/path?query=x → /path?query=x", () => {
      expect(sanitizeNext("/path?query=x")).toBe("/path?query=x");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("/path#hash → /path#hash", () => {
      expect(sanitizeNext("/path#hash")).toBe("/path#hash");
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("URLs absolues (rejetées avec reason=not_relative)", () => {
    it("https://evil.com → null + log not_relative", () => {
      expect(sanitizeNext("https://evil.com")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=not_relative",
        ),
      );
    });

    it("http://evil.com → null + log not_relative", () => {
      expect(sanitizeNext("http://evil.com")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=not_relative",
        ),
      );
    });
  });

  describe("protocol-relative slash (rejetés)", () => {
    it("//evil.com → null + log protocol_relative_slash", () => {
      expect(sanitizeNext("//evil.com")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=protocol_relative_slash",
        ),
      );
    });

    it("///evil.com → null + log protocol_relative_slash", () => {
      expect(sanitizeNext("///evil.com")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=protocol_relative_slash",
        ),
      );
    });
  });

  describe("backslash protocol-relative (gap principal T-314)", () => {
    it("/\\evil.com → null + log protocol_relative_backslash", () => {
      expect(sanitizeNext("/\\evil.com")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=protocol_relative_backslash",
        ),
      );
    });

    it("/\\\\evil.com → null + log protocol_relative_backslash", () => {
      expect(sanitizeNext("/\\\\evil.com")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=protocol_relative_backslash",
        ),
      );
    });
  });

  describe("schemes dangereux (rejetés)", () => {
    it("javascript:alert(1) → null + log dangerous_scheme", () => {
      expect(sanitizeNext("javascript:alert(1)")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=dangerous_scheme",
        ),
      );
    });

    it("data:text/html,<script>alert(1)</script> → null + log dangerous_scheme", () => {
      expect(sanitizeNext("data:text/html,<script>alert(1)</script>")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=dangerous_scheme",
        ),
      );
    });

    it("file:///etc/passwd → null + log dangerous_scheme", () => {
      expect(sanitizeNext("file:///etc/passwd")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=dangerous_scheme",
        ),
      );
    });

    it("vbscript:msgbox → null + log dangerous_scheme", () => {
      expect(sanitizeNext("vbscript:msgbox")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=dangerous_scheme",
        ),
      );
    });

    it("JavaScript:alert(1) (case-insensitive) → null + log dangerous_scheme", () => {
      expect(sanitizeNext("JavaScript:alert(1)")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=dangerous_scheme",
        ),
      );
    });
  });

  describe("control chars (anti log forging T-314)", () => {
    it("/path\\r\\nLocation:evil → null + log control_chars", () => {
      expect(sanitizeNext("/path\r\nLocation:evil")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=control_chars",
        ),
      );
    });

    it("/path\\n → null + log control_chars", () => {
      expect(sanitizeNext("/path\n")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=control_chars",
        ),
      );
    });

    it("/path\\0evil (null byte) → null + log control_chars", () => {
      expect(sanitizeNext("/path\0evil")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=control_chars",
        ),
      );
    });

    it("/path\\t → null + log control_chars", () => {
      expect(sanitizeNext("/path\t")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=control_chars",
        ),
      );
    });
  });

  describe("edges (null / undefined / empty / non-string)", () => {
    it("null → null (silencieux, pas de log)", () => {
      expect(sanitizeNext(null)).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("undefined → null (silencieux, pas de log)", () => {
      expect(sanitizeNext(undefined)).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("'' (string vide) → null (silencieux, pas de log)", () => {
      expect(sanitizeNext("")).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("123 (non-string) → null + log empty_or_invalid", () => {
      expect(sanitizeNext(123 as unknown)).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=empty_or_invalid",
        ),
      );
    });
  });

  describe("whitespace prefix (rejetés via not_relative)", () => {
    it("' /path' (space prefix) → null + log not_relative", () => {
      expect(sanitizeNext(" /path")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[SANITIZE_NEXT_REJECTED] reason=not_relative",
        ),
      );
    });
  });

  describe("logging forensique format greppable Vercel", () => {
    it("inclut raw_length pour debug forensique sans fuite raw verbatim", () => {
      sanitizeNext("https://evil.example.com/phishing");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("raw_length=33"),
      );
    });

    it("ne logge JAMAIS raw verbatim (anti log forging + anti PII)", () => {
      sanitizeNext("/path\r\ninjected_log_line");
      const calls = warnSpy.mock.calls.flat() as string[];
      const allOutput = calls.join(" ");
      expect(allOutput).not.toContain("injected_log_line");
    });
  });
});

import { describe, it, expect } from "vitest";
import { maskIp } from "@/lib/rgpd/mask-ip";

describe("maskIp", () => {
  describe("input vide ou invalide", () => {
    it.each([null, undefined, "", "   "])("retourne null pour %s", (input) => {
      expect(maskIp(input)).toBeNull();
    });

    it("trim leading/trailing whitespace", () => {
      expect(maskIp("  203.0.113.42  ")).toBe("203.0.113.0");
    });
  });

  describe("IPv4", () => {
    it("masque le 4e octet (RFC /24)", () => {
      expect(maskIp("203.0.113.42")).toBe("203.0.113.0");
    });

    it("préserve les 3 premiers octets identiques", () => {
      expect(maskIp("198.51.100.7")).toBe("198.51.100.0");
      expect(maskIp("10.0.0.1")).toBe("10.0.0.0");
    });

    it("borne haute 255", () => {
      expect(maskIp("255.255.255.255")).toBe("255.255.255.0");
    });

    it("borne basse 0", () => {
      expect(maskIp("0.0.0.0")).toBe("0.0.0.0");
    });

    it("rejette octets >255", () => {
      expect(maskIp("256.1.1.1")).toBeNull();
      expect(maskIp("1.1.1.999")).toBeNull();
    });

    it("rejette format incomplet", () => {
      expect(maskIp("1.2.3")).toBeNull();
      expect(maskIp("1.2.3.4.5")).toBeNull();
    });

    it("rejette chars non numériques", () => {
      expect(maskIp("abc.def.ghi.jkl")).toBeNull();
      expect(maskIp("1.2.3.x")).toBeNull();
    });
  });

  describe("IPv6", () => {
    it("masque les 4 derniers groupes (RFC /64) sur format expansé", () => {
      expect(maskIp("2001:db8:abcd:1234:5678:9abc:def0:1234")).toBe(
        "2001:db8:abcd:1234::",
      );
    });

    it("expand format compressé puis masque /64", () => {
      expect(maskIp("2001:db8::1")).toBe("2001:db8::");
      expect(maskIp("fe80::abcd")).toBe("fe80::");
    });

    it("loopback ::1 → ::", () => {
      expect(maskIp("::1")).toBe("::");
    });

    it("zero address :: → ::", () => {
      expect(maskIp("::")).toBe("::");
    });

    it("normalise hex en lowercase", () => {
      expect(maskIp("2001:DB8:ABCD:1234:5678:9ABC:DEF0:1234")).toBe(
        "2001:db8:abcd:1234::",
      );
    });

    it("retire les zeros leading sur chaque groupe (canonique RFC 5952)", () => {
      expect(maskIp("2001:0db8:00ab:0001:0000:0000:0000:0001")).toBe(
        "2001:db8:ab:1::",
      );
    });

    it("rejette double-compression `::a::1`", () => {
      expect(maskIp("::a::1")).toBeNull();
    });

    it("rejette chars hex invalides", () => {
      expect(maskIp("zzzz::1")).toBeNull();
      expect(maskIp("2001:db8:abcd:gggg:5678:9abc:def0:1234")).toBeNull();
    });

    it("rejette groupes >4 chars", () => {
      expect(maskIp("20011:db8::1")).toBeNull();
    });

    it("rejette format incomplet (trop de groupes après expansion)", () => {
      expect(
        maskIp("2001:db8:abcd:1234:5678:9abc:def0:1234:5678"),
      ).toBeNull();
    });

    it("rejette format incomplet (pas assez de groupes sans compression)", () => {
      expect(maskIp("2001:db8:abcd:1234")).toBeNull();
    });
  });

  describe("IPv4-mapped IPv6", () => {
    it("préserve le préfixe ::ffff: et masque l'IPv4 embarquée", () => {
      expect(maskIp("::ffff:203.0.113.42")).toBe("::ffff:203.0.113.0");
    });

    it("accepte le préfixe en majuscules", () => {
      expect(maskIp("::FFFF:198.51.100.7")).toBe("::ffff:198.51.100.0");
    });

    it("rejette IPv4 embarquée invalide", () => {
      expect(maskIp("::ffff:300.1.1.1")).toBeNull();
    });
  });

  describe("malformed", () => {
    it.each([
      "not-an-ip",
      "1.2.3.4.5.6",
      "::ffff::1",
      "2001:db8:::1",
      ":::",
      "::g",
      "1.2.3.4:5",
    ])("retourne null pour input cassé %s", (input) => {
      expect(maskIp(input)).toBeNull();
    });
  });
});

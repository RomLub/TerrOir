import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `lib/auth/role-snapshot-cookie.ts` importe 'server-only' (virtuel Next.js,
// non résolvable hors build webpack) → stub no-op pour vitest.
vi.mock("server-only", () => ({}));

// Secret figé pour la durée des tests : permet de calculer des fixtures
// déterministes (signatures connues à l'avance pour les cas tamper).
const TEST_SECRET = "a".repeat(64);
const ORIGINAL_SECRET = process.env.ROLE_SNAPSHOT_SECRET;

beforeEach(() => {
  process.env.ROLE_SNAPSHOT_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.ROLE_SNAPSHOT_SECRET;
  } else {
    process.env.ROLE_SNAPSHOT_SECRET = ORIGINAL_SECRET;
  }
});

import {
  signRoleSnapshot,
  parseAndVerifyRoleSnapshot,
  cookieNameForHost,
  cookieOptionsForHost,
  ROLE_SNAPSHOT_TTL_SECONDS,
  setRoleSnapshotOnResponseCookies,
  clearRoleSnapshotOnResponseCookies,
  setRoleSnapshotOnStore,
  clearRoleSnapshotOnStore,
  type RoleSnapshotPayload,
} from "@/lib/auth/role-snapshot-cookie";

const futurePayload: RoleSnapshotPayload = {
  user_id: "user-42",
  roles: ["consumer"],
  isAdmin: false,
  expires_at: Date.now() + 60_000,
};

describe("signRoleSnapshot + parseAndVerifyRoleSnapshot", () => {
  it("roundtrip : sign puis parse retourne le payload original", () => {
    const value = signRoleSnapshot(futurePayload);
    const parsed = parseAndVerifyRoleSnapshot(value);
    expect(parsed).toEqual(futurePayload);
  });

  it("roundtrip avec roles multiples + isAdmin true", () => {
    const payload: RoleSnapshotPayload = {
      user_id: "admin-1",
      roles: ["consumer", "producer"],
      isAdmin: true,
      expires_at: Date.now() + 30_000,
    };
    const parsed = parseAndVerifyRoleSnapshot(signRoleSnapshot(payload));
    expect(parsed).toEqual(payload);
  });

  it("rejette null / undefined / chaîne vide", () => {
    expect(parseAndVerifyRoleSnapshot(null)).toBeNull();
    expect(parseAndVerifyRoleSnapshot(undefined)).toBeNull();
    expect(parseAndVerifyRoleSnapshot("")).toBeNull();
  });

  it("rejette payload tampered (signature ne match plus)", () => {
    const value = signRoleSnapshot(futurePayload);
    const [encoded, sig] = value.split(".");
    // On modifie un bit du payload ; la sig recomputed côté verify différera.
    const tamperedEncoded = encoded!.replace(/^./, (c) =>
      c === "A" ? "B" : "A",
    );
    expect(
      parseAndVerifyRoleSnapshot(`${tamperedEncoded}.${sig}`),
    ).toBeNull();
  });

  it("rejette signature tampered", () => {
    const value = signRoleSnapshot(futurePayload);
    const [encoded] = value.split(".");
    const fakeSig = "0".repeat(64);
    expect(parseAndVerifyRoleSnapshot(`${encoded}.${fakeSig}`)).toBeNull();
  });

  it("rejette signature de longueur incorrecte (pas 64 hex chars)", () => {
    const value = signRoleSnapshot(futurePayload);
    const [encoded] = value.split(".");
    expect(parseAndVerifyRoleSnapshot(`${encoded}.deadbeef`)).toBeNull();
  });

  it("rejette signature avec caractères non-hex", () => {
    const value = signRoleSnapshot(futurePayload);
    const [encoded] = value.split(".");
    expect(parseAndVerifyRoleSnapshot(`${encoded}.${"z".repeat(64)}`)).toBeNull();
  });

  it("rejette format sans séparateur point", () => {
    expect(parseAndVerifyRoleSnapshot("nopointhere")).toBeNull();
  });

  it("rejette point en début ou fin (encodedPayload vide ou sig vide)", () => {
    expect(parseAndVerifyRoleSnapshot(".sig")).toBeNull();
    expect(parseAndVerifyRoleSnapshot("encoded.")).toBeNull();
  });

  it("rejette payload expiré (expires_at <= Date.now())", () => {
    const expiredPayload: RoleSnapshotPayload = {
      ...futurePayload,
      expires_at: Date.now() - 1,
    };
    const value = signRoleSnapshot(expiredPayload);
    expect(parseAndVerifyRoleSnapshot(value)).toBeNull();
  });

  it("rejette payload avec champs manquants (user_id absent)", () => {
    const incomplete = { roles: [], isAdmin: false, expires_at: Date.now() + 60_000 };
    const json = JSON.stringify(incomplete);
    const encoded = Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    // Sign manuellement avec le bon secret pour bien tester le shape check
    // (pas le HMAC check).
    const { createHmac } = require("crypto") as typeof import("crypto");
    const sig = createHmac("sha256", TEST_SECRET).update(encoded).digest("hex");
    expect(parseAndVerifyRoleSnapshot(`${encoded}.${sig}`)).toBeNull();
  });

  it("rejette payload avec types incorrects (roles non-array)", () => {
    const wrongShape = {
      user_id: "u",
      roles: "consumer",
      isAdmin: false,
      expires_at: Date.now() + 60_000,
    };
    const json = JSON.stringify(wrongShape);
    const encoded = Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const { createHmac } = require("crypto") as typeof import("crypto");
    const sig = createHmac("sha256", TEST_SECRET).update(encoded).digest("hex");
    expect(parseAndVerifyRoleSnapshot(`${encoded}.${sig}`)).toBeNull();
  });

  it("rejette JSON invalide (payload pas un objet JSON sérialisable)", () => {
    const encoded = Buffer.from("not-json{{", "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const { createHmac } = require("crypto") as typeof import("crypto");
    const sig = createHmac("sha256", TEST_SECRET).update(encoded).digest("hex");
    expect(parseAndVerifyRoleSnapshot(`${encoded}.${sig}`)).toBeNull();
  });

  it("signature change si secret rotated (ancienne signature invalide)", () => {
    const value = signRoleSnapshot(futurePayload);
    process.env.ROLE_SNAPSHOT_SECRET = "b".repeat(64);
    expect(parseAndVerifyRoleSnapshot(value)).toBeNull();
  });

  it("getSecret throws si ROLE_SNAPSHOT_SECRET absent (sign)", () => {
    delete process.env.ROLE_SNAPSHOT_SECRET;
    expect(() => signRoleSnapshot(futurePayload)).toThrow(
      /ROLE_SNAPSHOT_SECRET is not set/,
    );
  });

  it("getSecret throws si ROLE_SNAPSHOT_SECRET absent (verify)", () => {
    const value = signRoleSnapshot(futurePayload);
    delete process.env.ROLE_SNAPSHOT_SECRET;
    expect(() => parseAndVerifyRoleSnapshot(value)).toThrow(
      /ROLE_SNAPSHOT_SECRET is not set/,
    );
  });
});

describe("cookieNameForHost", () => {
  it("admin.* → sb-admin-role-snapshot (isolation Chantier 4)", () => {
    expect(cookieNameForHost("admin.terroir-local.fr")).toBe(
      "sb-admin-role-snapshot",
    );
    expect(cookieNameForHost("admin.terroir-local.fr:443")).toBe(
      "sb-admin-role-snapshot",
    );
  });

  it("www / pro / apex → __terroir_role_snapshot", () => {
    expect(cookieNameForHost("www.terroir-local.fr")).toBe(
      "__terroir_role_snapshot",
    );
    expect(cookieNameForHost("pro.terroir-local.fr")).toBe(
      "__terroir_role_snapshot",
    );
    expect(cookieNameForHost("terroir-local.fr")).toBe(
      "__terroir_role_snapshot",
    );
  });

  it("localhost → __terroir_role_snapshot (default)", () => {
    expect(cookieNameForHost("localhost:3000")).toBe("__terroir_role_snapshot");
  });

  it("null / undefined → default", () => {
    expect(cookieNameForHost(null)).toBe("__terroir_role_snapshot");
    expect(cookieNameForHost(undefined)).toBe("__terroir_role_snapshot");
  });
});

describe("cookieOptionsForHost", () => {
  it("www prod → domain .terroir-local.fr + secure + httpOnly + sameSite lax", () => {
    const opts = cookieOptionsForHost("www.terroir-local.fr");
    expect(opts.domain).toBe(".terroir-local.fr");
    expect(opts.secure).toBe(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(ROLE_SNAPSHOT_TTL_SECONDS);
  });

  it("admin prod → PAS de domain (isolation admin.* exclusive)", () => {
    const opts = cookieOptionsForHost("admin.terroir-local.fr");
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(true);
  });

  it("localhost → pas de domain + secure off (HTTP dev)", () => {
    const opts = cookieOptionsForHost("localhost:3000");
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);
  });

  it("admin.localhost → pas de domain + secure off", () => {
    const opts = cookieOptionsForHost("admin.localhost:3000");
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);
  });
});

describe("setRoleSnapshotOnResponseCookies / clearRoleSnapshotOnResponseCookies", () => {
  it("set : cookie posé avec name + value signée + options corrects", () => {
    const calls: { name: string; value: string; options: unknown }[] = [];
    const responseCookies = {
      set: (name: string, value: string, options: unknown) => {
        calls.push({ name, value, options });
      },
    };
    setRoleSnapshotOnResponseCookies(responseCookies, "www.terroir-local.fr", {
      user_id: "u-1",
      roles: ["consumer"],
      isAdmin: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("__terroir_role_snapshot");
    // Valeur signée → parsable
    const parsed = parseAndVerifyRoleSnapshot(calls[0]!.value);
    expect(parsed?.user_id).toBe("u-1");
    expect(parsed?.roles).toEqual(["consumer"]);
    expect(parsed?.isAdmin).toBe(false);
    expect(parsed?.expires_at).toBeGreaterThan(Date.now());
  });

  it("clear : cookie posé maxAge=0 + même name/options pour forcer suppression browser", () => {
    const calls: { name: string; value: string; options: { maxAge?: number } }[] = [];
    const responseCookies = {
      set: (name: string, value: string, options: { maxAge?: number }) => {
        calls.push({ name, value, options });
      },
    };
    clearRoleSnapshotOnResponseCookies(
      responseCookies,
      "admin.terroir-local.fr",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("sb-admin-role-snapshot");
    expect(calls[0]!.value).toBe("");
    expect(calls[0]!.options.maxAge).toBe(0);
  });
});

describe("setRoleSnapshotOnStore / clearRoleSnapshotOnStore", () => {
  it("set : délègue à cookieStore.set avec name correct selon host", () => {
    const calls: { name: string; value: string; options: unknown }[] = [];
    const cookieStore = {
      set: (name: string, value: string, options: unknown) => {
        calls.push({ name, value, options });
      },
    };
    setRoleSnapshotOnStore(cookieStore, "pro.terroir-local.fr", {
      user_id: "u-2",
      roles: ["producer"],
      isAdmin: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("__terroir_role_snapshot");
  });

  it("clear : délègue avec maxAge=0", () => {
    const calls: { name: string; value: string; options: { maxAge?: number } }[] = [];
    const cookieStore = {
      set: (name: string, value: string, options: { maxAge?: number }) => {
        calls.push({ name, value, options });
      },
    };
    clearRoleSnapshotOnStore(cookieStore, "www.terroir-local.fr");
    expect(calls[0]!.options.maxAge).toBe(0);
  });

  it("clear : no-op si store invalide (pas de set)", () => {
    expect(() =>
      clearRoleSnapshotOnStore({} as unknown as { set: never }, "www"),
    ).not.toThrow();
  });
});

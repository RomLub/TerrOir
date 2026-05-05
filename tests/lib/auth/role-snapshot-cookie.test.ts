import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";

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

// Helper : compute hex HMAC-SHA256 avec Node crypto (vitest runtime Node, OK).
// Sert à fabriquer des signatures valides pour les tests qui exercent les
// shape checks post-verify (ex: payload avec champ manquant). La prod utilise
// crypto.subtle (Web Crypto) — la sortie hex est identique pour le même
// secret + message, donc la sig calculée ici sera acceptée par
// parseAndVerifyRoleSnapshot côté prod.
function nodeHmacHex(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function base64urlForTest(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("signRoleSnapshot + parseAndVerifyRoleSnapshot", () => {
  it("roundtrip : sign puis parse retourne le payload original", async () => {
    const value = await signRoleSnapshot(futurePayload);
    const parsed = await parseAndVerifyRoleSnapshot(value);
    expect(parsed).toEqual(futurePayload);
  });

  it("roundtrip avec roles multiples + isAdmin true", async () => {
    const payload: RoleSnapshotPayload = {
      user_id: "admin-1",
      roles: ["consumer", "producer"],
      isAdmin: true,
      expires_at: Date.now() + 30_000,
    };
    const parsed = await parseAndVerifyRoleSnapshot(
      await signRoleSnapshot(payload),
    );
    expect(parsed).toEqual(payload);
  });

  it("rejette null / undefined / chaîne vide", async () => {
    expect(await parseAndVerifyRoleSnapshot(null)).toBeNull();
    expect(await parseAndVerifyRoleSnapshot(undefined)).toBeNull();
    expect(await parseAndVerifyRoleSnapshot("")).toBeNull();
  });

  it("rejette payload tampered (signature ne match plus)", async () => {
    const value = await signRoleSnapshot(futurePayload);
    const [encoded, sig] = value.split(".");
    // On modifie un bit du payload ; la sig recomputed côté verify différera.
    const tamperedEncoded = encoded!.replace(/^./, (c) =>
      c === "A" ? "B" : "A",
    );
    expect(
      await parseAndVerifyRoleSnapshot(`${tamperedEncoded}.${sig}`),
    ).toBeNull();
  });

  it("rejette signature tampered", async () => {
    const value = await signRoleSnapshot(futurePayload);
    const [encoded] = value.split(".");
    const fakeSig = "0".repeat(64);
    expect(
      await parseAndVerifyRoleSnapshot(`${encoded}.${fakeSig}`),
    ).toBeNull();
  });

  it("rejette signature de longueur incorrecte (pas 64 hex chars)", async () => {
    const value = await signRoleSnapshot(futurePayload);
    const [encoded] = value.split(".");
    expect(
      await parseAndVerifyRoleSnapshot(`${encoded}.deadbeef`),
    ).toBeNull();
  });

  it("rejette signature avec caractères non-hex", async () => {
    const value = await signRoleSnapshot(futurePayload);
    const [encoded] = value.split(".");
    expect(
      await parseAndVerifyRoleSnapshot(`${encoded}.${"z".repeat(64)}`),
    ).toBeNull();
  });

  it("rejette format sans séparateur point", async () => {
    expect(await parseAndVerifyRoleSnapshot("nopointhere")).toBeNull();
  });

  it("rejette point en début ou fin (encodedPayload vide ou sig vide)", async () => {
    expect(await parseAndVerifyRoleSnapshot(".sig")).toBeNull();
    expect(await parseAndVerifyRoleSnapshot("encoded.")).toBeNull();
  });

  it("rejette payload expiré (expires_at <= Date.now())", async () => {
    const expiredPayload: RoleSnapshotPayload = {
      ...futurePayload,
      expires_at: Date.now() - 1,
    };
    const value = await signRoleSnapshot(expiredPayload);
    expect(await parseAndVerifyRoleSnapshot(value)).toBeNull();
  });

  it("rejette payload avec champs manquants (user_id absent)", async () => {
    const incomplete = {
      roles: [],
      isAdmin: false,
      expires_at: Date.now() + 60_000,
    };
    const encoded = base64urlForTest(JSON.stringify(incomplete));
    // Sign manuellement avec le bon secret pour bien tester le shape check
    // (pas le HMAC check). Node createHmac == Web Crypto subtle pour
    // HMAC-SHA256 hex — sortie identique.
    const sig = nodeHmacHex(encoded, TEST_SECRET);
    expect(
      await parseAndVerifyRoleSnapshot(`${encoded}.${sig}`),
    ).toBeNull();
  });

  it("rejette payload avec types incorrects (roles non-array)", async () => {
    const wrongShape = {
      user_id: "u",
      roles: "consumer",
      isAdmin: false,
      expires_at: Date.now() + 60_000,
    };
    const encoded = base64urlForTest(JSON.stringify(wrongShape));
    const sig = nodeHmacHex(encoded, TEST_SECRET);
    expect(
      await parseAndVerifyRoleSnapshot(`${encoded}.${sig}`),
    ).toBeNull();
  });

  it("rejette JSON invalide (payload pas un objet JSON sérialisable)", async () => {
    const encoded = base64urlForTest("not-json{{");
    const sig = nodeHmacHex(encoded, TEST_SECRET);
    expect(
      await parseAndVerifyRoleSnapshot(`${encoded}.${sig}`),
    ).toBeNull();
  });

  it("signature change si secret rotated (ancienne signature invalide)", async () => {
    const value = await signRoleSnapshot(futurePayload);
    process.env.ROLE_SNAPSHOT_SECRET = "b".repeat(64);
    expect(await parseAndVerifyRoleSnapshot(value)).toBeNull();
  });

  it("getSecret throws si ROLE_SNAPSHOT_SECRET absent (sign)", async () => {
    delete process.env.ROLE_SNAPSHOT_SECRET;
    await expect(signRoleSnapshot(futurePayload)).rejects.toThrow(
      /ROLE_SNAPSHOT_SECRET is not set/,
    );
  });

  it("getSecret throws si ROLE_SNAPSHOT_SECRET absent (verify)", async () => {
    const value = await signRoleSnapshot(futurePayload);
    delete process.env.ROLE_SNAPSHOT_SECRET;
    await expect(parseAndVerifyRoleSnapshot(value)).rejects.toThrow(
      /ROLE_SNAPSHOT_SECRET is not set/,
    );
  });
});

describe("cookieNameForHost (M-2 prefixes __Secure-/__Host-)", () => {
  it("admin.* prod → __Host-sb-admin-role-snapshot (no domain → __Host- compatible)", () => {
    expect(cookieNameForHost("admin.terroir-local.fr")).toBe(
      "__Host-sb-admin-role-snapshot",
    );
    expect(cookieNameForHost("admin.terroir-local.fr:443")).toBe(
      "__Host-sb-admin-role-snapshot",
    );
  });

  it("www / pro / apex prod → __Secure-terroir_role_snapshot", () => {
    expect(cookieNameForHost("www.terroir-local.fr")).toBe(
      "__Secure-terroir_role_snapshot",
    );
    expect(cookieNameForHost("pro.terroir-local.fr")).toBe(
      "__Secure-terroir_role_snapshot",
    );
    expect(cookieNameForHost("terroir-local.fr")).toBe(
      "__Secure-terroir_role_snapshot",
    );
  });

  it("localhost dev → fallback legacy __terroir_role_snapshot (préfixes rejetés sans HTTPS)", () => {
    expect(cookieNameForHost("localhost:3000")).toBe("__terroir_role_snapshot");
  });

  it("admin.localhost dev → fallback legacy sb-admin-role-snapshot", () => {
    expect(cookieNameForHost("admin.localhost:3000")).toBe(
      "sb-admin-role-snapshot",
    );
  });

  it("null / undefined → default legacy (host non détectable = treat as dev)", () => {
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
  it("set : cookie posé avec name + value signée + options corrects", async () => {
    const calls: { name: string; value: string; options: unknown }[] = [];
    const responseCookies = {
      set: (name: string, value: string, options: unknown) => {
        calls.push({ name, value, options });
      },
    };
    await setRoleSnapshotOnResponseCookies(
      responseCookies,
      "www.terroir-local.fr",
      {
        user_id: "u-1",
        roles: ["consumer"],
        isAdmin: false,
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("__Secure-terroir_role_snapshot");
    // Valeur signée → parsable
    const parsed = await parseAndVerifyRoleSnapshot(calls[0]!.value);
    expect(parsed?.user_id).toBe("u-1");
    expect(parsed?.roles).toEqual(["consumer"]);
    expect(parsed?.isAdmin).toBe(false);
    expect(parsed?.expires_at).toBeGreaterThan(Date.now());
  });

  it("clear : pose nouveau ET legacy en prod (M-2 transition double-clear)", () => {
    const calls: { name: string; value: string; options: { maxAge?: number } }[] =
      [];
    const responseCookies = {
      set: (name: string, value: string, options: { maxAge?: number }) => {
        calls.push({ name, value, options });
      },
    };
    clearRoleSnapshotOnResponseCookies(
      responseCookies,
      "admin.terroir-local.fr",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.name).toBe("__Host-sb-admin-role-snapshot");
    expect(calls[1]!.name).toBe("sb-admin-role-snapshot");
    expect(calls.every((c) => c.value === "")).toBe(true);
    expect(calls.every((c) => c.options.maxAge === 0)).toBe(true);
  });

  it("clear dev : pose 1 seul cookie (legacy = nouveau)", () => {
    const calls: { name: string; value: string; options: { maxAge?: number } }[] =
      [];
    const responseCookies = {
      set: (name: string, value: string, options: { maxAge?: number }) => {
        calls.push({ name, value, options });
      },
    };
    clearRoleSnapshotOnResponseCookies(responseCookies, "localhost:3000");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("__terroir_role_snapshot");
  });
});

describe("setRoleSnapshotOnStore / clearRoleSnapshotOnStore", () => {
  it("set : délègue à cookieStore.set avec name correct selon host", async () => {
    const calls: { name: string; value: string; options: unknown }[] = [];
    const cookieStore = {
      set: (name: string, value: string, options: unknown) => {
        calls.push({ name, value, options });
      },
    };
    await setRoleSnapshotOnStore(cookieStore, "pro.terroir-local.fr", {
      user_id: "u-2",
      roles: ["producer"],
      isAdmin: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("__Secure-terroir_role_snapshot");
  });

  it("clear : délègue avec maxAge=0", () => {
    const calls: { name: string; value: string; options: { maxAge?: number } }[] =
      [];
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

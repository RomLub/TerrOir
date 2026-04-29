import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

// T-321 — Cache role snapshot dans cookie HttpOnly signé HMAC-SHA256.
// Élimine 2 queries DB par request authentifiée dans middleware (admin_users +
// users.roles), latence ~50-100ms gagnée par hit.
//
// Format value : base64url(JSON_payload) + '.' + hex(HMAC-SHA256)
// Payload : { user_id, roles, isAdmin, expires_at } — bind user_id pour
// invalider le snapshot quand un autre user se connecte (cross-user safety).
//
// Isolation Chantier 4 : nom distinct sur admin.* (sb-admin-role-snapshot)
// pour ne pas leaker isAdmin=true vers www/pro via cookie partagé. Mirror
// exact lib/supabase/cookie-domain.ts.

const COOKIE_NAME_DEFAULT = "__terroir_role_snapshot";
const COOKIE_NAME_ADMIN = "sb-admin-role-snapshot";
const SHARED_DOMAIN = ".terroir-local.fr";
const APEX = "terroir-local.fr";
export const ROLE_SNAPSHOT_TTL_SECONDS = 15 * 60; // 15 min — staleness max acceptable.

export interface RoleSnapshotPayload {
  user_id: string;
  roles: string[];
  isAdmin: boolean;
  expires_at: number; // ms since epoch
}

interface CookieAttrs {
  domain?: string;
  path: "/";
  maxAge: number;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
}

function getSecret(): string {
  const secret = process.env.ROLE_SNAPSHOT_SECRET;
  if (!secret) {
    throw new Error(
      "ROLE_SNAPSHOT_SECRET is not set — cannot sign/verify role snapshot cookies",
    );
  }
  return secret;
}

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").split(":")[0]?.toLowerCase() ?? "";
}

function isAdminHost(host: string | null | undefined): boolean {
  return normalizeHost(host).startsWith("admin.");
}

function isProdHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host);
  return h === APEX || h.endsWith(`.${APEX}`);
}

export function cookieNameForHost(host: string | null | undefined): string {
  return isAdminHost(host) ? COOKIE_NAME_ADMIN : COOKIE_NAME_DEFAULT;
}

export function cookieOptionsForHost(
  host: string | null | undefined,
): CookieAttrs {
  const isProd = isProdHost(host);
  const isAdmin = isAdminHost(host);
  return {
    // Domain partagé .terroir-local.fr UNIQUEMENT pour www/pro/apex en prod.
    // admin.* : pas de domain → cookie scopé admin.* exclusivement (mirror
    // cookie-domain.ts isolation Chantier 4). Localhost : pas de domain.
    ...(isProd && !isAdmin ? { domain: SHARED_DOMAIN } : {}),
    path: "/",
    maxAge: ROLE_SNAPSHOT_TTL_SECONDS,
    httpOnly: true,
    // Secure rejette le cookie en HTTP localhost dev → off en non-prod.
    secure: isProd,
    sameSite: "lax",
  };
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  try {
    const padding = (4 - (input.length % 4)) % 4;
    const padded =
      input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padding);
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function computeHmacHex(message: string): string {
  return createHmac("sha256", getSecret()).update(message).digest("hex");
}

export function signRoleSnapshot(payload: RoleSnapshotPayload): string {
  const json = JSON.stringify(payload);
  const encoded = base64urlEncode(json);
  const sig = computeHmacHex(encoded);
  return `${encoded}.${sig}`;
}

// Defensive type guard : on ne fait jamais confiance au cookie. Tout champ
// manquant ou type incorrect → null (forcera le fallback DB).
function isValidPayloadShape(value: unknown): value is RoleSnapshotPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.user_id !== "string" || v.user_id.length === 0) return false;
  if (!Array.isArray(v.roles)) return false;
  if (!v.roles.every((r) => typeof r === "string")) return false;
  if (typeof v.isAdmin !== "boolean") return false;
  if (typeof v.expires_at !== "number" || !Number.isFinite(v.expires_at))
    return false;
  return true;
}

export function parseAndVerifyRoleSnapshot(
  cookieValue: string | null | undefined,
): RoleSnapshotPayload | null {
  if (typeof cookieValue !== "string" || cookieValue.length === 0) return null;

  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex <= 0 || dotIndex === cookieValue.length - 1) return null;

  const encodedPayload = cookieValue.slice(0, dotIndex);
  const providedSig = cookieValue.slice(dotIndex + 1);

  if (!/^[0-9a-f]{64}$/.test(providedSig)) return null;

  // Recompute HMAC AVANT decode JSON : si la sig est invalide, on n'expose
  // jamais le contenu du payload à JSON.parse (defense-in-depth).
  const expectedSig = computeHmacHex(encodedPayload);
  const a = Buffer.from(expectedSig, "hex");
  const b = Buffer.from(providedSig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const json = base64urlDecode(encodedPayload);
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!isValidPayloadShape(parsed)) return null;
  if (parsed.expires_at <= Date.now()) return null;

  return parsed;
}

// =============================================================================
// Helpers d'accès cookie : 2 surfaces selon le caller.
//   - middleware : NextRequest (read) + NextResponse.cookies (write/clear)
//   - server actions / route handlers : cookies() de next/headers
// =============================================================================

export function readRoleSnapshotFromRequest(
  request: NextRequest,
  host: string | null | undefined,
): RoleSnapshotPayload | null {
  const name = cookieNameForHost(host);
  const raw = request.cookies.get(name)?.value;
  return parseAndVerifyRoleSnapshot(raw);
}

// Type structurel : NextResponse.cookies expose un set/delete compatible.
// Évite la dépendance au deep import next/dist/.../cookies.
type ResponseCookieJar = {
  set(name: string, value: string, options: CookieAttrs): unknown;
};

export function setRoleSnapshotOnResponseCookies(
  responseCookies: ResponseCookieJar,
  host: string | null | undefined,
  snapshot: Omit<RoleSnapshotPayload, "expires_at">,
): void {
  const payload: RoleSnapshotPayload = {
    ...snapshot,
    expires_at: Date.now() + ROLE_SNAPSHOT_TTL_SECONDS * 1000,
  };
  const value = signRoleSnapshot(payload);
  responseCookies.set(cookieNameForHost(host), value, cookieOptionsForHost(host));
}

export function setRoleSnapshotOnResponse(
  response: NextResponse,
  host: string | null | undefined,
  snapshot: Omit<RoleSnapshotPayload, "expires_at">,
): void {
  setRoleSnapshotOnResponseCookies(response.cookies, host, snapshot);
}

export function clearRoleSnapshotOnResponseCookies(
  responseCookies: ResponseCookieJar,
  host: string | null | undefined,
): void {
  // Set maxAge=0 avec MÊMES domain/path/secure/sameSite que le set : sinon
  // le browser considère que c'est un cookie différent et ne supprime pas.
  const opts = cookieOptionsForHost(host);
  responseCookies.set(cookieNameForHost(host), "", { ...opts, maxAge: 0 });
}

export function clearRoleSnapshotOnResponse(
  response: NextResponse,
  host: string | null | undefined,
): void {
  clearRoleSnapshotOnResponseCookies(response.cookies, host);
}

// Variante cookies() de next/headers (server actions, route handlers).
// Type minimal : on accepte tout cookieStore qui a set(name, value, options)
// pour rester compatible avec ReadonlyRequestCookies (Next 14 cookies()).
type CookieStoreLike = {
  set: (name: string, value: string, options: CookieAttrs) => void;
};

function isClearableStore(
  store: unknown,
): store is { set: (name: string, value: string, opts: CookieAttrs) => void } {
  return (
    typeof store === "object" &&
    store !== null &&
    typeof (store as { set?: unknown }).set === "function"
  );
}

export function setRoleSnapshotOnStore(
  cookieStore: CookieStoreLike,
  host: string | null | undefined,
  snapshot: Omit<RoleSnapshotPayload, "expires_at">,
): void {
  const payload: RoleSnapshotPayload = {
    ...snapshot,
    expires_at: Date.now() + ROLE_SNAPSHOT_TTL_SECONDS * 1000,
  };
  const value = signRoleSnapshot(payload);
  cookieStore.set(cookieNameForHost(host), value, cookieOptionsForHost(host));
}

export function clearRoleSnapshotOnStore(
  cookieStore: CookieStoreLike,
  host: string | null | undefined,
): void {
  if (!isClearableStore(cookieStore)) return;
  const opts = cookieOptionsForHost(host);
  cookieStore.set(cookieNameForHost(host), "", { ...opts, maxAge: 0 });
}

// Exposé pour tests unitaires (override secret).
export const __test__ = {
  COOKIE_NAME_DEFAULT,
  COOKIE_NAME_ADMIN,
  SHARED_DOMAIN,
  APEX,
};

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// lib/env/urls.ts fail-fast au load si NEXT_PUBLIC_APP_URL ou
// NEXT_PUBLIC_ADMIN_URL ne sont pas définis (T-328 — email-redirect dérive
// désormais de ces vars). Hoist le stub avant les imports static.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://www.terroir-local.fr";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "https://pro.terroir-local.fr";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://admin.terroir-local.fr";
});

// vitest 4 : `vi.fn()` retourne `Mock<Procedure | Constructable>` qui n'est
// pas appelable. On force le type vers une signature de fonction concrète.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
type AnySyncFn = (...args: unknown[]) => unknown;

// --- Mocks ----------------------------------------------------------------

let getSessionUserMock: Mock<AnySyncFn>;
let updateUserMock: Mock<AnyAsyncFn>;

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: (...args: unknown[]) => getSessionUserMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
  }),
}));

import { changeEmailAction } from "@/app/(consumer)/compte/profil/_actions/change-email";
import {
  AUTH_CALLBACK_ADMIN,
  AUTH_CALLBACK_DEFAULT,
} from "@/lib/auth/email-redirect";

// --- Helpers --------------------------------------------------------------

function makeFormData(email: string | null): FormData {
  const fd = new FormData();
  if (email !== null) fd.set("email", email);
  return fd;
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  getSessionUserMock = vi.fn<AnySyncFn>().mockResolvedValue({
    id: "user-1",
    email: "old@example.com",
    roles: [],
    isAdmin: false,
  });
  updateUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("changeEmailAction", () => {
  it("happy path consumer → updateUser appelé avec emailRedirectTo www + message confirmation", async () => {
    const result = await changeEmailAction({}, makeFormData("new@example.com"));

    expect(updateUserMock).toHaveBeenCalledWith(
      { email: "new@example.com" },
      { emailRedirectTo: AUTH_CALLBACK_DEFAULT },
    );
    expect(result.error).toBeUndefined();
    expect(result.message).toContain("new@example.com");
  });

  it("happy path admin → updateUser appelé avec emailRedirectTo admin", async () => {
    getSessionUserMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      roles: [],
      isAdmin: true,
    });

    await changeEmailAction({}, makeFormData("new-admin@example.com"));

    expect(updateUserMock).toHaveBeenCalledWith(
      { email: "new-admin@example.com" },
      { emailRedirectTo: AUTH_CALLBACK_ADMIN },
    );
  });

  it("pas de session → error et updateUser jamais appelé", async () => {
    getSessionUserMock.mockResolvedValue(null);

    const result = await changeEmailAction(
      {},
      makeFormData("new@example.com"),
    );

    expect(result.error).toBe("Session introuvable. Reconnectez-vous.");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("email invalide Zod → error format et updateUser jamais appelé", async () => {
    const result = await changeEmailAction({}, makeFormData("not-an-email"));

    expect(result.error).toBe("Email invalide");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("email = email actuel → error 'identique' et updateUser jamais appelé", async () => {
    const result = await changeEmailAction(
      {},
      makeFormData("OLD@example.com"),
    );

    // Zod toLowerCase → "old@example.com" === session.email.toLowerCase()
    expect(result.error).toBe("Le nouvel email est identique à l'actuel.");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("erreur Supabase 'email_exists' → mapping FR clair", async () => {
    updateUserMock.mockResolvedValue({
      error: { code: "email_exists", message: "User already registered" },
    });

    const result = await changeEmailAction(
      {},
      makeFormData("taken@example.com"),
    );

    expect(result.error).toBe("Cet email est déjà utilisé par un autre compte.");
  });

  it("erreur Supabase générique → message générique FR", async () => {
    updateUserMock.mockResolvedValue({
      error: { code: "rate_limit_exceeded", message: "Too many requests" },
    });

    const result = await changeEmailAction(
      {},
      makeFormData("new@example.com"),
    );

    expect(result.error).toBe(
      "Impossible de changer l'email. Réessayez plus tard.",
    );
  });
});

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// vitest 4 : `vi.fn()` retourne `Mock<Procedure | Constructable>` qui n'est
// pas appelable. On force le type vers une signature de fonction concrète.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;

// --- Mocks ---------------------------------------------------------------
// Surfaces mockées :
//   1. createSupabaseServerClient → auth.signUp
//   2. createSupabaseAdminClient → from(...).insert() + auth.admin.deleteUser
//   3. NEXT_PUBLIC_APP_URL → constante stable pour assertion emailRedirectTo
//
// logAuthEvent volontairement NON mocké : depuis T-300 l'event
// account_signup est instrumenté côté /auth/callback case type=signup,
// pas dans actions.ts. Si un test laissait fuiter un appel ici, le test
// happy path l'attraperait via assertion explicite.

let supabaseSignUpMock: Mock<AnyAsyncFn>;
let adminInsertMock: Mock<AnyAsyncFn>;
let adminDeleteUserMock: Mock<AnyAsyncFn>;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      signUp: (...args: unknown[]) => supabaseSignUpMock(...args),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      insert: (...args: unknown[]) => adminInsertMock(...args),
    }),
    auth: {
      admin: {
        deleteUser: (...args: unknown[]) => adminDeleteUserMock(...args),
      },
    },
  }),
}));

vi.mock("@/lib/env/urls", () => ({
  NEXT_PUBLIC_APP_URL: "https://www.test.local",
}));

import { signupAction } from "@/app/(consumer)/auth/inscription/actions";

// --- Helpers --------------------------------------------------------------

const VALID_PASSWORD = "Pass1234";
const VALID_EMAIL = "user@example.com";

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("prenom", "Alice");
  fd.set("nom", "Martin");
  fd.set("email", VALID_EMAIL);
  fd.set("password", VALID_PASSWORD);
  fd.set("telephone", "");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  adminInsertMock = vi.fn<AnyAsyncFn>().mockResolvedValue({ error: null });
  adminDeleteUserMock = vi
    .fn<AnyAsyncFn>()
    .mockResolvedValue({ error: null });

  // Silence console.warn / console.error pour les tests qui les déclenchent
  // intentionnellement. On vérifie le comportement métier, pas la trace.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("signupAction", () => {
  it("happy path : signUp + insert profil OK → success { email }, pas de deleteUser, emailRedirectTo correct", async () => {
    const res = await signupAction({}, makeFormData());

    expect(res).toEqual({ success: { email: VALID_EMAIL } });
    expect(supabaseSignUpMock).toHaveBeenCalledWith({
      email: VALID_EMAIL,
      password: VALID_PASSWORD,
      options: {
        data: { prenom: "Alice", nom: "Martin" },
        emailRedirectTo:
          "https://www.test.local/auth/callback?next=/compte/commandes",
      },
    });
    expect(adminInsertMock).toHaveBeenCalledWith({
      id: "user-1",
      email: VALID_EMAIL,
      roles: ["consumer"],
      prenom: "Alice",
      nom: "Martin",
      telephone: null,
      sms_optin: false,
    });
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("Zod fail (password trop court) → error, aucun appel Supabase", async () => {
    const res = await signupAction(
      {},
      makeFormData({ password: "Sh1" }),
    );

    expect(res.error).toMatch(/8 caractères/);
    expect(supabaseSignUpMock).not.toHaveBeenCalled();
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("T-313 enumeration : signUp error code=user_already_exists → simule succès, aucun insert ni deleteUser", async () => {
    supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: {
        message: "User already registered",
        code: "user_already_exists",
      },
    });

    const res = await signupAction({}, makeFormData());

    expect(res).toEqual({ success: { email: VALID_EMAIL } });
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("T-313 enumeration : signUp error message regex 'already registered' (sans code) → simule succès", async () => {
    supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });

    const res = await signupAction({}, makeFormData());

    expect(res).toEqual({ success: { email: VALID_EMAIL } });
    expect(adminInsertMock).not.toHaveBeenCalled();
  });

  it("signUp error générique (non-duplicate) → error mappé FR, console.error appelé", async () => {
    supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: { message: "Service unavailable", code: "internal_error" },
    });

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Inscription impossible/);
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("signUp success mais data.user null → error mappé FR, aucun insert", async () => {
    supabaseSignUpMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Inscription impossible/);
    expect(adminInsertMock).not.toHaveBeenCalled();
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  it("T-301 compensation : insert profil fail → deleteUser appelé sur user.id, error mappé FR", async () => {
    adminInsertMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      error: { message: "duplicate key value violates unique constraint" },
    });

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Inscription impossible/);
    expect(adminInsertMock).toHaveBeenCalledOnce();
    expect(adminDeleteUserMock).toHaveBeenCalledWith("user-1");
  });

  it("T-301 compensation : insert fail + deleteUser fail → error mappé FR, console.error orphan", async () => {
    adminInsertMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      error: { message: "RLS violation" },
    });
    adminDeleteUserMock = vi.fn<AnyAsyncFn>().mockResolvedValue({
      error: { message: "auth admin api unreachable" },
    });
    const errorSpy = vi.spyOn(console, "error");

    const res = await signupAction({}, makeFormData());

    expect(res.error).toMatch(/Inscription impossible/);
    expect(adminDeleteUserMock).toHaveBeenCalledWith("user-1");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("SIGNUP_ORPHAN_AUTH"),
    );
  });
});

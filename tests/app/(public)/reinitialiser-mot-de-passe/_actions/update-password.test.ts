import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---------------------------------------------------------------
// Le redirect Next.js réel throw NEXT_REDIRECT en succès. On stubbe avec un
// throw maison qu'on attrape dans le helper runAction() pour laisser les
// assertions s'exécuter.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

// revalidatePath() requiert un static generation store en runtime — absent en
// test (env=node). Mock en no-op : on assertera l'appel via vi.mocked().
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// --- Mock Supabase server : auth.verifyOtp + auth.updateUser configurables
type VerifyOtpResp = { error: { message: string } | null };
type UpdateUserResp = {
  data: { user: { id: string } | null };
  error: { message: string } | null;
};

let verifyOtpResp: VerifyOtpResp;
let updateUserResp: UpdateUserResp;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      verifyOtp: async () => verifyOtpResp,
      updateUser: async () => updateUserResp,
    },
  }),
}));

// Mock logAuthEvent : asserté pour le happy path uniquement.
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: vi.fn(async () => {}),
}));

// Imports APRÈS les vi.mock (hoistés) pour récupérer les versions mockées.
import { revalidatePath } from "next/cache";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { updatePasswordAction } from "@/app/(public)/reinitialiser-mot-de-passe/_actions/update-password";

// --- Helpers --------------------------------------------------------------

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("token_hash", "valid-token-hash-1234567890");
  fd.set("password", "NewSecret123");
  fd.set("passwordConfirm", "NewSecret123");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

async function runAction(
  formData: FormData,
): Promise<{ error?: string; expired?: boolean } | undefined> {
  // Le redirect mocké throw __REDIRECT__ en chemin succès. On l'attrape pour
  // laisser les assertions s'exécuter ; toute autre erreur remonte.
  try {
    return await updatePasswordAction({}, formData);
  } catch (e) {
    if (!String(e).includes("__REDIRECT__")) throw e;
    return undefined;
  }
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  verifyOtpResp = { error: null };
  updateUserResp = { data: { user: { id: "user-42" } }, error: null };
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(logAuthEvent).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("updatePasswordAction — fix navbar post password recovery (T-306)", () => {
  it("happy path : revalidatePath('/', 'layout') appelé AVANT redirect /compte?password=updated + audit log password_changed", async () => {
    const result = await new Promise<{
      thrown: unknown;
      revalidatedAtThrow: boolean;
    }>((resolve) => {
      let revalidatedAtThrow = false;
      vi.mocked(revalidatePath).mockImplementationOnce(() => {
        revalidatedAtThrow = true;
      });
      updatePasswordAction({}, makeFormData())
        .then(() =>
          resolve({ thrown: undefined, revalidatedAtThrow }),
        )
        .catch((e) => resolve({ thrown: e, revalidatedAtThrow }));
    });

    // Le redirect mocké a bien throw __REDIRECT__:/compte?password=updated
    expect(String(result.thrown)).toContain(
      "__REDIRECT__:/compte?password=updated",
    );
    // Et revalidatePath a été appelé AVANT que le throw redirect ne survienne.
    expect(result.revalidatedAtThrow).toBe(true);

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/", "layout");

    expect(vi.mocked(logAuthEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAuthEvent)).toHaveBeenCalledWith({
      eventType: "password_changed",
      userId: "user-42",
    });
  });

  it("token expiré : verifyOtp fail → expired:true, pas de revalidatePath, pas de redirect, pas d'audit log", async () => {
    verifyOtpResp = { error: { message: "Token has expired or is invalid" } };

    const result = await runAction(makeFormData());

    expect(result?.expired).toBe(true);
    expect(result?.error).toContain("expiré");
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(vi.mocked(logAuthEvent)).not.toHaveBeenCalled();
  });

  it("updateUser fail : verifyOtp ok mais updateUser fail → error, pas de revalidatePath, pas de redirect, pas d'audit log", async () => {
    updateUserResp = {
      data: { user: null },
      error: { message: "Password too weak" },
    };

    const result = await runAction(makeFormData());

    expect(result?.error).toContain("Impossible de mettre à jour");
    expect(result?.expired).toBeUndefined();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(vi.mocked(logAuthEvent)).not.toHaveBeenCalled();
  });

  it("validation Zod : password < 8 caractères → error, aucun side effect (pas de verifyOtp, pas de revalidatePath, pas de redirect)", async () => {
    const result = await runAction(
      makeFormData({ password: "abc12", passwordConfirm: "abc12" }),
    );

    expect(result?.error).toContain("8 caractères");
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(vi.mocked(logAuthEvent)).not.toHaveBeenCalled();
  });
});

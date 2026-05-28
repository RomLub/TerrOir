// Tests vitest des server actions /creneaux : wrappers FormData pour les
// indispos producteur (PR #2). Les helpers backend (lib/unavailabilities/*)
// sont couverts par leurs propres suites — ici on vérifie que les wrappers
// composent correctement (session, ownership, FormData parsing,
// revalidatePath).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/unavailabilities/create", () => ({
  createUnavailabilities: vi.fn(),
}));
vi.mock("@/lib/unavailabilities/delete", () => ({
  deleteUnavailability: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createUnavailabilities } from "@/lib/unavailabilities/create";
import { deleteUnavailability } from "@/lib/unavailabilities/delete";
import {
  createUnavailabilitiesAction,
  deleteUnavailabilityAction,
} from "@/app/(producer)/creneaux/actions";

const SESSION = {
  id: "user-prod-owner",
  email: "prod@example.com",
  roles: ["producer"],
  isAdmin: false,
} as const;

const PRODUCER_ID = "prod-1";

function mockAuthAndProducer() {
  vi.mocked(getSessionUser).mockResolvedValue(SESSION as never);
  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: PRODUCER_ID }, error: null }),
        }),
      }),
    }),
  } as never);
}

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(createUnavailabilities).mockReset();
  vi.mocked(deleteUnavailability).mockReset();
  vi.mocked(revalidatePath).mockReset();
});

describe("createUnavailabilitiesAction — wrapper FormData", () => {
  it("non authentifié → INVALID_INPUT, helper jamais appelé", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    const fd = new FormData();
    fd.append("dates", "2099-08-14");

    const res = await createUnavailabilitiesAction(null, fd);
    expect(res).toMatchObject({ code: "INVALID_INPUT" });
    expect(createUnavailabilities).not.toHaveBeenCalled();
  });

  it("FormData dates[] + raison → input passé au helper", async () => {
    mockAuthAndProducer();
    vi.mocked(createUnavailabilities).mockResolvedValue({
      success: true,
      created_count: 2,
    });

    const fd = new FormData();
    fd.append("dates", "2099-08-14");
    fd.append("dates", "2099-08-15");
    fd.set("raison", "Congés été");

    const res = await createUnavailabilitiesAction(null, fd);
    expect(res).toEqual({ success: true, created_count: 2 });
    expect(createUnavailabilities).toHaveBeenCalledWith({
      producerId: PRODUCER_ID,
      dates: ["2099-08-14", "2099-08-15"],
      raison: "Congés été",
      createdBy: SESSION.id,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/creneaux");
  });

  it("FormData sans raison → null persisté côté helper", async () => {
    mockAuthAndProducer();
    vi.mocked(createUnavailabilities).mockResolvedValue({
      success: true,
      created_count: 1,
    });

    const fd = new FormData();
    fd.append("dates", "2099-08-14");

    await createUnavailabilitiesAction(null, fd);
    expect(createUnavailabilities).toHaveBeenCalledWith(
      expect.objectContaining({ raison: null }),
    );
  });

  it("retour BLOCKING_ORDERS → propagé tel quel, aucune revalidate", async () => {
    mockAuthAndProducer();
    vi.mocked(createUnavailabilities).mockResolvedValue({
      error: "Commandes",
      code: "BLOCKING_ORDERS",
      blocking_orders: [],
    });

    const fd = new FormData();
    fd.append("dates", "2099-08-14");

    const res = await createUnavailabilitiesAction(null, fd);
    expect(res).toMatchObject({ code: "BLOCKING_ORDERS" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteUnavailabilityAction — wrapper id", () => {
  it("non authentifié → INVALID_INPUT, helper jamais appelé", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    const res = await deleteUnavailabilityAction("u-1");
    expect(res).toMatchObject({ code: "INVALID_INPUT" });
    expect(deleteUnavailability).not.toHaveBeenCalled();
  });

  it("id valide → helper appelé avec producerId + revalidate", async () => {
    mockAuthAndProducer();
    vi.mocked(deleteUnavailability).mockResolvedValue({
      success: true,
      regenerated_slots: 6,
    });

    const res = await deleteUnavailabilityAction("u-1");
    expect(res).toEqual({ success: true, regenerated_slots: 6 });
    expect(deleteUnavailability).toHaveBeenCalledWith({
      producerId: PRODUCER_ID,
      unavailabilityId: "u-1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/creneaux");
  });

  it("retour NOT_FOUND → propagé, aucune revalidate", async () => {
    mockAuthAndProducer();
    vi.mocked(deleteUnavailability).mockResolvedValue({
      error: "Indisponibilité introuvable.",
      code: "NOT_FOUND",
    });

    const res = await deleteUnavailabilityAction("u-x");
    expect(res).toMatchObject({ code: "NOT_FOUND" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

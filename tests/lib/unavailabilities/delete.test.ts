import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/slots/generate", () => ({
  invalidateProducer: vi.fn(),
  generateSlotsForProducerOnDate: vi.fn(),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  invalidateProducer,
  generateSlotsForProducerOnDate,
} from "@/lib/slots/generate";
import { deleteUnavailability } from "@/lib/unavailabilities/delete";

const PRODUCER_ID = "prod-1";
const OTHER_PRODUCER = "prod-other";
const UNAVAIL_ID = "unavail-1";

type DeleteCapture = {
  deletedIds: string[];
  slotUpdates: Array<Record<string, unknown>>;
};

function makeAdmin(opts: {
  lookup?: {
    data: { id: string; producer_id: string; date: string } | null;
    error?: { message: string } | null;
  };
  deleteError?: { message: string } | null;
  unexcludeError?: { message: string } | null;
}): { client: SupabaseClient; captured: DeleteCapture } {
  const captured: DeleteCapture = { deletedIds: [], slotUpdates: [] };

  const client = {
    from: (table: string) => {
      if (table === "unavailabilities") {
        const builder: any = {};
        let mode: "select" | "delete" | null = null;
        builder.select = () => {
          mode = "select";
          return builder;
        };
        builder.delete = () => {
          mode = "delete";
          return builder;
        };
        builder.eq = (col: string, val: any) => {
          if (mode === "delete" && col === "id") {
            captured.deletedIds.push(String(val));
            return Promise.resolve({ error: opts.deleteError ?? null });
          }
          return builder;
        };
        builder.maybeSingle = () =>
          Promise.resolve(
            opts.lookup ?? { data: null, error: null },
          );
        return builder;
      }
      if (table === "slots") {
        const state: { payload: Record<string, unknown> | null } = {
          payload: null,
        };
        const builder: any = {};
        builder.update = (payload: Record<string, unknown>) => {
          state.payload = payload;
          return builder;
        };
        builder.eq = () => builder;
        builder.not = () => builder;
        builder.gte = () => builder;
        builder.lte = () => {
          captured.slotUpdates.push(state.payload ?? {});
          return Promise.resolve({ error: opts.unexcludeError ?? null });
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

beforeEach(() => {
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(invalidateProducer).mockReset();
  vi.mocked(generateSlotsForProducerOnDate).mockReset();
});

describe("deleteUnavailability", () => {
  it("unavailabilityId vide → INVALID_INPUT", async () => {
    const res = await deleteUnavailability({
      producerId: PRODUCER_ID,
      unavailabilityId: "",
    });
    expect(res).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("introuvable → NOT_FOUND, aucun side effect", async () => {
    const { client, captured } = makeAdmin({
      lookup: { data: null, error: null },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await deleteUnavailability({
      producerId: PRODUCER_ID,
      unavailabilityId: UNAVAIL_ID,
    });
    expect(res).toMatchObject({ code: "NOT_FOUND" });
    expect(captured.deletedIds).toHaveLength(0);
    expect(captured.slotUpdates).toHaveLength(0);
    expect(generateSlotsForProducerOnDate).not.toHaveBeenCalled();
  });

  it("ownership KO (autre producteur) → NOT_FOUND, aucun delete", async () => {
    const { client, captured } = makeAdmin({
      lookup: {
        data: { id: UNAVAIL_ID, producer_id: OTHER_PRODUCER, date: "2099-08-14" },
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await deleteUnavailability({
      producerId: PRODUCER_ID,
      unavailabilityId: UNAVAIL_ID,
    });
    expect(res).toMatchObject({ code: "NOT_FOUND" });
    expect(captured.deletedIds).toHaveLength(0);
    expect(captured.slotUpdates).toHaveLength(0);
    expect(generateSlotsForProducerOnDate).not.toHaveBeenCalled();
  });

  it("delete OK → UN-exclude slots du jour + regen ciblée + invalidateProducer", async () => {
    const { client, captured } = makeAdmin({
      lookup: {
        data: { id: UNAVAIL_ID, producer_id: PRODUCER_ID, date: "2099-08-14" },
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(generateSlotsForProducerOnDate).mockResolvedValue({ inserted: 6 });

    const res = await deleteUnavailability({
      producerId: PRODUCER_ID,
      unavailabilityId: UNAVAIL_ID,
    });

    expect(res).toEqual({ success: true, regenerated_slots: 6 });
    expect(captured.deletedIds).toEqual([UNAVAIL_ID]);
    expect(captured.slotUpdates).toHaveLength(1);
    // UN-exclude = excluded_at: null
    expect(captured.slotUpdates[0]).toEqual({ excluded_at: null });
    expect(invalidateProducer).toHaveBeenCalledWith(PRODUCER_ID);
    expect(generateSlotsForProducerOnDate).toHaveBeenCalledWith(
      client,
      PRODUCER_ID,
      "2099-08-14",
    );
  });

  it("regen échoue → success quand même (logué en warn)", async () => {
    const { client, captured } = makeAdmin({
      lookup: {
        data: { id: UNAVAIL_ID, producer_id: PRODUCER_ID, date: "2099-08-14" },
        error: null,
      },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(generateSlotsForProducerOnDate).mockRejectedValue(
      new Error("regen boom"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await deleteUnavailability({
      producerId: PRODUCER_ID,
      unavailabilityId: UNAVAIL_ID,
    });
    expect(res).toEqual({ success: true, regenerated_slots: 0 });
    expect(captured.deletedIds).toEqual([UNAVAIL_ID]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("delete SQL error → INTERNAL, aucune regen", async () => {
    const { client, captured } = makeAdmin({
      lookup: {
        data: { id: UNAVAIL_ID, producer_id: PRODUCER_ID, date: "2099-08-14" },
        error: null,
      },
      deleteError: { message: "FK constraint" },
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(client);

    const res = await deleteUnavailability({
      producerId: PRODUCER_ID,
      unavailabilityId: UNAVAIL_ID,
    });
    expect(res).toMatchObject({ code: "INTERNAL" });
    expect(captured.slotUpdates).toHaveLength(0);
    expect(generateSlotsForProducerOnDate).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vitest";
import { sliceWindow } from "@/lib/slots/slice-window";

const H = 3_600_000;
const M = 60_000;

// now fixé dans le passé par rapport aux plages testées → tout est futur,
// sauf le test dédié au filtrage des tranches passées.
const now = Date.UTC(2026, 5, 1, 0, 0, 0);

describe("sliceWindow", () => {
  it("découpe une plage en tranches complètes", () => {
    const start = now + 9 * H;
    const end = now + 11 * H; // 2h → 4 tranches de 30 min
    const out = sliceWindow(start, end, 30, now);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ startsAtMs: start, endsAtMs: start + 30 * M });
    expect(out[3].endsAtMs).toBe(end);
  });

  it("ignore la tranche partielle finale", () => {
    const start = now + 9 * H;
    const end = start + 50 * M; // 50 min / 20 → 2 tranches (40 min), reste 10 ignoré
    const out = sliceWindow(start, end, 20, now);
    expect(out).toHaveLength(2);
  });

  it("ignore les tranches dont le début est <= now", () => {
    const start = now - 1 * H;
    const end = now + 1 * H;
    const out = sliceWindow(start, end, 30, now);
    expect(out.every((s) => s.startsAtMs > now)).toBe(true);
    expect(out).toHaveLength(1); // seule [now+30, now+60] est future et complète
  });

  it("durée <= 0 → vide", () => {
    expect(sliceWindow(now, now + H, 0, now)).toEqual([]);
  });

  it("plage plus courte qu'une tranche → vide", () => {
    expect(
      sliceWindow(now + 9 * H, now + 9 * H + 20 * M, 30, now),
    ).toEqual([]);
  });
});

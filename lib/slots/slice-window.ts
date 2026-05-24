// Découpe une plage [startMs, endMs) en tranches de `durationMin` minutes.
// Ne garde que les tranches COMPLÈTES (start + durée <= fin) et FUTURES
// (start > nowMs). Miroir de la boucle de matérialisation de generate.ts,
// extrait ici comme helper pur pour :
//   - les créneaux ponctuels en mode rendez-vous (createAdHocSlotAction),
//   - la testabilité unitaire sans Supabase.
// Cf. ADR-0012.

export type WindowSlice = { startsAtMs: number; endsAtMs: number };

export function sliceWindow(
  startMs: number,
  endMs: number,
  durationMin: number,
  nowMs: number,
): WindowSlice[] {
  const out: WindowSlice[] = [];
  if (durationMin <= 0) return out;
  const durationMs = durationMin * 60_000;
  let s = startMs;
  while (s + durationMs <= endMs) {
    if (s > nowMs) out.push({ startsAtMs: s, endsAtMs: s + durationMs });
    s += durationMs;
  }
  return out;
}

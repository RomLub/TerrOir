// Test d'intégration SQL — RPC `get_producer_dashboard`, focus sur les
// nouveaux champs payload du chantier "Planning de la semaine — heatmap"
// (2026-05-28) :
//   - `slots[].capacity_per_slot` exposé
//   - `slots[].orders_count` agrégé (pending+confirmed+ready uniquement)
//   - `slots[]` filtre `excluded_at IS NULL`
//   - `week_open_days` bool[7] (index 0=Lun → 6=Dim)
//
// Pré-requis : `npx supabase start`. Sans instance locale, la suite est
// skippée proprement.

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getSqlIntegrationClient,
  isLocalSupabaseReachable,
} from "./helpers/client";
import {
  seedProducer,
  cleanupProducer,
  type SeededProducer,
} from "./helpers/seed";

const SUPABASE = getSqlIntegrationClient();

// Helper : appelle la RPC avec des bornes calculées autour d'un weekStart
// donné (timestamptz UTC à minuit Paris du lundi). Les autres ancres
// (today, yesterday, etc.) sont posées arbitrairement — on ne les exerce
// pas dans ces tests, on se concentre sur le bloc slots/week_open_days.
function rpcArgsForWeek(producerId: string, userId: string, weekStartIso: string) {
  // weekStartIso = "YYYY-MM-DD" du lundi en heure locale Paris. On
  // reconstruit les bornes timestamptz à minuit Paris (UTC+1 hiver / UTC+2
  // été — le test couvre les deux cas via DST).
  const weekStart = new Date(`${weekStartIso}T00:00:00+01:00`); // hiver fallback
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
  const lastWeekStart = new Date(weekStart.getTime() - 7 * 86_400_000);
  const today = new Date(weekStart.getTime() + 86_400_000); // mardi de la semaine
  const yesterday = new Date(today.getTime() - 86_400_000);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const slotsRangeStart = new Date(weekStart.getTime() - 86_400_000);
  const slotsRangeEnd = new Date(weekEnd.getTime() + 86_400_000);
  const weekEndIso = new Date(weekEnd.getTime()).toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);

  return {
    p_producer_id: producerId,
    p_user_id: userId,
    p_today_start: today.toISOString(),
    p_yesterday_start: yesterday.toISOString(),
    p_tomorrow_start: tomorrow.toISOString(),
    p_week_start: weekStart.toISOString(),
    p_week_end: weekEnd.toISOString(),
    p_last_week_start: lastWeekStart.toISOString(),
    p_slots_range_start: slotsRangeStart.toISOString(),
    p_slots_range_end: slotsRangeEnd.toISOString(),
    p_today_iso: todayIso,
    p_week_start_iso: weekStartIso,
    p_week_end_iso: weekEndIso,
  };
}

type DashPayload = {
  slots: Array<{
    id: string;
    starts_at: string;
    ends_at: string;
    capacity_per_slot: number;
    orders_count: number;
  }>;
  week_open_days: boolean[];
};

async function callDashboard(
  args: ReturnType<typeof rpcArgsForWeek>,
): Promise<DashPayload> {
  const { data, error } = await SUPABASE.rpc("get_producer_dashboard", args);
  if (error) throw new Error(`RPC error: ${error.message}`);
  return data as DashPayload;
}

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

describeIfLocal(
  "get_producer_dashboard — payload Planning heatmap",
  () => {
    let seeded: SeededProducer;

    beforeAll(() => {
      if (!reachable) {
        console.warn(
          "[sql-it] Supabase locale non joignable, tests SQL skippés. " +
            "Lance `npx supabase start` pour exécuter la suite.",
        );
      }
    });

    afterEach(async () => {
      if (seeded) {
        // Cleanup slots + slot_rules (CASCADE depuis producers, mais on
        // purge explicitement pour la lisibilité forensique).
        await SUPABASE.from("slots").delete().eq("producer_id", seeded.producerId);
        await SUPABASE.from("slot_rules").delete().eq(
          "producer_id",
          seeded.producerId,
        );
        await cleanupProducer(SUPABASE, seeded);
      }
    });

    // ─── week_open_days ──────────────────────────────────────────────────────

    it("jour fermé partout : producteur sans aucune slot_rule ni ponctuel → bool[7] = [false × 7]", async () => {
      seeded = await seedProducer(SUPABASE);
      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-05-25"),
      );
      expect(dash.week_open_days).toEqual([
        false, false, false, false, false, false, false,
      ]);
    });

    it("rule active sur mercredi (js_dow=3) : seul l'index 2 (Mer) est true", async () => {
      seeded = await seedProducer(SUPABASE);
      // days_of_week = [3] = mercredi (convention JS, 0=dim).
      // Mapping index Lun→Dim : 0=Lun (js 1), 1=Mar (js 2), 2=Mer (js 3).
      const { error } = await SUPABASE.from("slot_rules").insert({
        producer_id: seeded.producerId,
        days_of_week: [3],
        start_time: "09:00",
        end_time: "12:00",
        slot_duration_minutes: 60,
        capacity_per_slot: 5,
        active: true,
      });
      if (error) throw new Error(error.message);

      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-05-25"),
      );
      expect(dash.week_open_days).toEqual([
        false, false, true, false, false, false, false,
      ]);
    });

    it("rule inactive (active=false) : pas d'ouverture détectée pour ses dow", async () => {
      seeded = await seedProducer(SUPABASE);
      await SUPABASE.from("slot_rules").insert({
        producer_id: seeded.producerId,
        days_of_week: [1, 2, 3],
        start_time: "09:00",
        end_time: "12:00",
        slot_duration_minutes: 60,
        capacity_per_slot: 5,
        active: false,
      });
      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-05-25"),
      );
      expect(dash.week_open_days.every((b) => b === false)).toBe(true);
    });

    it("ponctuel uniquement (rule_id NULL) ce jeudi : seul index 3 (Jeu) est true", async () => {
      seeded = await seedProducer(SUPABASE);
      // Jeu 2026-05-28 09h-12h Paris (UTC+2 fin mai).
      await SUPABASE.from("slots").insert({
        producer_id: seeded.producerId,
        rule_id: null,
        starts_at: "2026-05-28T09:00:00+02:00",
        ends_at: "2026-05-28T12:00:00+02:00",
        capacity_per_slot: 3,
      });
      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-05-25"),
      );
      expect(dash.week_open_days).toEqual([
        false, false, false, true, false, false, false,
      ]);
    });

    it("ponctuel excluded_at posé : ne compte pas comme jour ouvert", async () => {
      seeded = await seedProducer(SUPABASE);
      await SUPABASE.from("slots").insert({
        producer_id: seeded.producerId,
        rule_id: null,
        starts_at: "2026-05-28T09:00:00+02:00",
        ends_at: "2026-05-28T12:00:00+02:00",
        capacity_per_slot: 3,
        excluded_at: new Date().toISOString(),
      });
      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-05-25"),
      );
      // Pas de rule active + ponctuel exclu → tous false.
      expect(dash.week_open_days.every((b) => b === false)).toBe(true);
    });

    // ─── slots[].capacity_per_slot + orders_count + excluded_at ─────────────

    it("slots[] expose capacity_per_slot et orders_count agrégé", async () => {
      seeded = await seedProducer(SUPABASE, { statut: "public" });
      // 1 slot ponctuel, capacity 5.
      const { data: slotRow, error: slotErr } = await SUPABASE
        .from("slots")
        .insert({
          producer_id: seeded.producerId,
          rule_id: null,
          starts_at: "2026-05-28T09:00:00+02:00",
          ends_at: "2026-05-28T12:00:00+02:00",
          capacity_per_slot: 5,
        })
        .select("id")
        .single();
      if (slotErr || !slotRow) throw new Error(slotErr?.message);
      const slotId = slotRow.id;

      // 3 orders sur ce slot avec statuts différents : 2 actifs comptés,
      // 1 cancelled exclu.
      const baseOrder = {
        consumer_id: seeded.userId, // self-order test : OK avec service_role
        producer_id: seeded.producerId,
        slot_id: slotId,
        montant_total: 10,
      };
      const { error: ordersErr } = await SUPABASE.from("orders").insert([
        { ...baseOrder, statut: "pending" },
        { ...baseOrder, statut: "confirmed" },
        { ...baseOrder, statut: "cancelled" },
      ]);
      if (ordersErr) throw new Error(ordersErr.message);

      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-05-25"),
      );
      const slot = dash.slots.find((s) => s.id === slotId);
      expect(slot).toBeDefined();
      expect(slot!.capacity_per_slot).toBe(5);
      // pending + confirmed = 2 ; cancelled exclu.
      expect(slot!.orders_count).toBe(2);
    });

    it("slot avec excluded_at posé : ABSENT de slots[]", async () => {
      seeded = await seedProducer(SUPABASE);
      const { data: visible } = await SUPABASE
        .from("slots")
        .insert({
          producer_id: seeded.producerId,
          rule_id: null,
          starts_at: "2026-05-28T09:00:00+02:00",
          ends_at: "2026-05-28T10:00:00+02:00",
          capacity_per_slot: 3,
        })
        .select("id")
        .single();
      const { data: hidden } = await SUPABASE
        .from("slots")
        .insert({
          producer_id: seeded.producerId,
          rule_id: null,
          starts_at: "2026-05-28T11:00:00+02:00",
          ends_at: "2026-05-28T12:00:00+02:00",
          capacity_per_slot: 3,
          excluded_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-05-25"),
      );
      const ids = dash.slots.map((s) => s.id);
      expect(ids).toContain(visible!.id);
      expect(ids).not.toContain(hidden!.id);
    });

    // ─── DST printemps + automne ────────────────────────────────────────────
    // Le 2026-03-29 (printemps) : passage UTC+1 → UTC+2. Le 2026-10-25
    // (automne) : passage UTC+2 → UTC+1. Le CTE week_open_days fait
    // `at time zone 'Europe/Paris'` pour comparer la date locale au
    // weekStartIso + i. Tests : un ponctuel posé sur le dimanche concerné
    // doit être détecté ouvert (index 6 = Dim).

    it("DST printemps (semaine du 23 mars 2026) : ponctuel le dimanche 29/03 → index 6 (Dim) ouvert", async () => {
      seeded = await seedProducer(SUPABASE);
      // 29/03/2026 14h Paris : 12h UTC en heure d'été (UTC+2).
      await SUPABASE.from("slots").insert({
        producer_id: seeded.producerId,
        rule_id: null,
        starts_at: "2026-03-29T14:00:00+02:00",
        ends_at: "2026-03-29T16:00:00+02:00",
        capacity_per_slot: 2,
      });
      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-03-23"),
      );
      // Lun→Dim : seul index 6 (Dim 29/03) ouvert.
      expect(dash.week_open_days).toEqual([
        false, false, false, false, false, false, true,
      ]);
    });

    it("DST automne (semaine du 19 oct 2026) : ponctuel le dimanche 25/10 → index 6 (Dim) ouvert", async () => {
      seeded = await seedProducer(SUPABASE);
      // 25/10/2026 14h Paris : 13h UTC en heure d'hiver (UTC+1).
      await SUPABASE.from("slots").insert({
        producer_id: seeded.producerId,
        rule_id: null,
        starts_at: "2026-10-25T14:00:00+01:00",
        ends_at: "2026-10-25T16:00:00+01:00",
        capacity_per_slot: 2,
      });
      const dash = await callDashboard(
        rpcArgsForWeek(seeded.producerId, seeded.userId, "2026-10-19"),
      );
      expect(dash.week_open_days).toEqual([
        false, false, false, false, false, false, true,
      ]);
    });
  },
);

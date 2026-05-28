import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TZDate } from "@date-fns/tz";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_ORDER_STATUTS } from "@/lib/orders/stateMachine";
import {
  parseWeekOffset,
  formatWeekRangeLabel,
} from "@/lib/dates/week-navigation";
import type { SlotRuleRow } from "@/lib/slots/validators";
import {
  groupWeekSlots,
  type CalendarSlot,
} from "@/lib/slots/group-week-slots";
import {
  groupCreneauxMonitoring,
  type MonitoringOrder,
  type MonitoringRule,
  type MonitoringSlot,
} from "@/lib/slots/group-creneaux-monitoring";
import { formatOrderNumber } from "@/lib/orders/order-number";
import { PageHeader } from "@/components/ui";
import { SectionSkeleton } from "../_components/ContentSkeletons";
import CreneauxCalendarClient from "./_components/CreneauxCalendarClient";
import { MonitoringSection } from "./_components/MonitoringSection";

// Rendu dynamique : les créneaux évoluent à chaque visite (nouveau slot
// matérialisé, exclusion, etc.). Pas de cache SSR.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TZ = "Europe/Paris";

// 7 clés de jour (yyyy-MM-dd, Europe/Paris) du lundi au dimanche pour la
// semaine ciblée par l'offset. Calculé en Paris pour éviter tout décalage
// UTC↔Paris au bornage du calendrier.
function parisWeekDayKeys(now: Date, offset: number): string[] {
  const p = new TZDate(now.getTime(), TZ);
  const dow = (p.getDay() + 6) % 7; // 0 = lundi
  const keys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new TZDate(
      p.getFullYear(),
      p.getMonth(),
      p.getDate() - dow + offset * 7 + i,
      0,
      0,
      0,
      TZ,
    );
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`,
    );
  }
  return keys;
}

function keyToParisIso(key: string, addDays = 0): string {
  const [y, m, d] = key.split("-").map(Number);
  return new TZDate(y!, m! - 1, d! + addDays, 0, 0, 0, TZ).toISOString();
}

// Coquille SYNCHRONE : le PageHeader s'affiche instantanément ; les gardes
// (session + producteur) sont déplacées dans le flux (CreneauxGate) → cadre
// instantané à la navigation, calendrier streamé.
export default function CreneauxPage({
  searchParams,
}: {
  // `day` (YYYY-MM-DD) est accepté pour le drill-down depuis le bandeau
  // Planning du dashboard. Pas encore consommé ici — la mise en focus de la
  // journée dans le calendrier viendra avec la refonte UX /creneaux
  // (ADR-0012). Typage déclaré dès maintenant pour ne pas perdre l'info en
  // navigation.
  searchParams: Promise<{ week?: string; day?: string }>;
}) {
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        tone="producer"
        eyebrow="Créneaux"
        title="Vos créneaux de retrait"
        subtitle="Votre agenda d'ouvertures. Ajoutez vos créneaux réguliers ou ponctuels, fermez un jour ou posez des vacances."
      />

      <Suspense fallback={<SectionSkeleton rows={5} />}>
        <CreneauxGate searchParamsPromise={searchParams} />
      </Suspense>
    </div>
  );
}

async function CreneauxGate({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ week?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const admin = createSupabaseAdminClient();
  const { data: producer } = await admin
    .from("producers")
    .select("id, producer_number")
    .eq("user_id", session.id)
    .maybeSingle();
  if (!producer) redirect("/invitation");

  const sp = await searchParamsPromise;
  const weekOffset = parseWeekOffset(sp.week);

  return (
    <CreneauxContent
      producerId={producer.id}
      producerNumber={producer.producer_number}
      weekOffset={weekOffset}
    />
  );
}

async function CreneauxContent({
  producerId,
  producerNumber,
  weekOffset,
}: {
  producerId: string;
  producerNumber: number;
  weekOffset: number;
}) {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const dayKeys = parisWeekDayKeys(now, weekOffset);
  const todayKey = parisWeekDayKeys(now, 0)[
    (new TZDate(now.getTime(), TZ).getDay() + 6) % 7
  ]!;

  const rangeStartIso = keyToParisIso(dayKeys[0]!);
  const rangeEndIso = keyToParisIso(dayKeys[6]!, 1); // lendemain du dimanche

  const [{ data: slotsRaw }, { data: rulesRaw }] = await Promise.all([
    admin
      .from("slots")
      .select("id, starts_at, ends_at, capacity_per_slot, rule_id, excluded_at")
      .eq("producer_id", producerId)
      .eq("active", true)
      .gte("starts_at", rangeStartIso)
      .lt("starts_at", rangeEndIso)
      .order("starts_at", { ascending: true }),
    admin
      .from("slot_rules")
      .select(
        "id, producer_id, days_of_week, periodicity_weeks, start_time, end_time, slot_duration_minutes, capacity_per_slot, mode, active, created_at, updated_at",
      )
      .eq("producer_id", producerId),
  ]);

  const slots = (slotsRaw ?? []) as unknown as CalendarSlot[];
  const rules = (rulesRaw ?? []) as unknown as SlotRuleRow[];

  // Commandes actives sur ces créneaux : alimente à la fois la garde
  // « Fermer ce jour » (Set<slot_id>) et le monitoring du remplissage
  // (Map<slot_id, MonitoringOrder[]> avec id, numero, prénom, createdAt).
  // ADR-0015 : le code_commande ne fuite plus côté producteur, on expose
  // le numero composé via producer_number + producer_order_seq.
  const slotIds = slots.map((s) => s.id);
  const blocked = new Set<string>();
  const ordersBySlot = new Map<string, MonitoringOrder[]>();
  if (slotIds.length > 0) {
    const { data: ordersRaw } = await admin
      .from("orders")
      .select(
        "id, producer_order_seq, slot_id, created_at, consumer:users!orders_consumer_id_fkey(prenom)",
      )
      .in("slot_id", slotIds)
      .in("statut", [...ACTIVE_ORDER_STATUTS]);
    type OrderRow = {
      id: string;
      producer_order_seq: number;
      slot_id: string | null;
      created_at: string;
      consumer: { prenom: string | null } | { prenom: string | null }[] | null;
    };
    for (const row of (ordersRaw ?? []) as unknown as OrderRow[]) {
      if (!row.slot_id) continue;
      blocked.add(row.slot_id);
      const consumer = Array.isArray(row.consumer)
        ? (row.consumer[0] ?? null)
        : row.consumer;
      const order: MonitoringOrder = {
        id: row.id,
        numero: formatOrderNumber(producerNumber, row.producer_order_seq),
        consumerFirstName: consumer?.prenom ?? null,
        createdAt: row.created_at,
      };
      const arr = ordersBySlot.get(row.slot_id);
      if (arr) arr.push(order);
      else ordersBySlot.set(row.slot_id, [order]);
    }
  }

  const days = groupWeekSlots({
    dayKeys,
    todayKey,
    slots,
    rules,
    blockedSlotIds: blocked,
  });

  const monitoringRules: MonitoringRule[] = rules.map((r) => ({
    id: r.id,
    mode: r.mode,
    capacity_per_slot: r.capacity_per_slot,
    slot_duration_minutes: r.slot_duration_minutes,
  }));
  const monitoringDays = groupCreneauxMonitoring({
    dayKeys,
    todayKey,
    slots: slots satisfies MonitoringSlot[],
    rules: monitoringRules,
    ordersBySlot,
  });

  const [ly, lm, ld] = dayKeys[0]!.split("-").map(Number);
  const periodLabel = formatWeekRangeLabel(new Date(ly!, lm! - 1, ld!));

  return (
    <>
      <CreneauxCalendarClient
        weekOffset={weekOffset}
        periodLabel={periodLabel}
        days={days}
        rules={rules}
      />
      <MonitoringSection days={monitoringDays} />
    </>
  );
}

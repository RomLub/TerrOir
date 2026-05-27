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
import { PageHeader } from "@/components/ui";
import { SectionSkeleton } from "../_components/ContentSkeletons";
import CreneauxCalendarClient from "./_components/CreneauxCalendarClient";

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
    .select("id")
    .eq("user_id", session.id)
    .maybeSingle();
  if (!producer) redirect("/invitation");

  const sp = await searchParamsPromise;
  const weekOffset = parseWeekOffset(sp.week);

  return <CreneauxContent producerId={producer.id} weekOffset={weekOffset} />;
}

async function CreneauxContent({
  producerId,
  weekOffset,
}: {
  producerId: string;
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

  // Commandes actives sur ces créneaux → bloque « Fermer ce jour ».
  const slotIds = slots.map((s) => s.id);
  let blocked = new Set<string>();
  if (slotIds.length > 0) {
    const { data: blockedRaw } = await admin
      .from("orders")
      .select("slot_id")
      .in("slot_id", slotIds)
      .in("statut", [...ACTIVE_ORDER_STATUTS]);
    blocked = new Set(
      (blockedRaw ?? [])
        .map((o) => o.slot_id as string | null)
        .filter((id): id is string => id !== null),
    );
  }

  const days = groupWeekSlots({
    dayKeys,
    todayKey,
    slots,
    rules,
    blockedSlotIds: blocked,
  });

  const [ly, lm, ld] = dayKeys[0]!.split("-").map(Number);
  const periodLabel = formatWeekRangeLabel(new Date(ly!, lm! - 1, ld!));

  return (
    <CreneauxCalendarClient
      weekOffset={weekOffset}
      periodLabel={periodLabel}
      days={days}
      rules={rules}
    />
  );
}

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SlotRuleRow } from "@/lib/slots/validators";
import { ProducerLayout } from "../_components/ProducerLayout";
import SlotRulesList from "./_components/SlotRulesList";
import AdHocSlotsList, {
  type AdHocSlot,
} from "./_components/AdHocSlotsList";
import ExceptionsList, {
  type ExcludedSlot,
} from "./_components/ExceptionsList";
import type { FutureActiveSlot } from "./_components/ExcludeSlotModal";

// Rendu dynamique : les datasets évoluent à chaque visite (nouveau slot
// matérialisé, exclusion ajoutée, etc.). Pas de cache SSR.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Limite le volume de slots actifs passés au ExcludeSlotModal. Au-delà, le
// producer utilisera plutôt le Bulk range. 200 couvre ~2 mois à rythme
// mercredi+samedi, 6 créneaux/jour.
const FUTURE_ACTIVE_SLOTS_LIMIT = 200;

export default async function CreneauxPage() {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const admin = createSupabaseAdminClient();
  const { data: producer } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", session.id)
    .maybeSingle();

  if (!producer) redirect("/invitation");

  const nowIso = new Date().toISOString();

  const [
    { data: rulesRaw },
    { data: adHocRaw },
    { data: exceptionsRaw },
    { data: futureActiveRaw },
  ] = await Promise.all([
    admin
      .from("slot_rules")
      .select(
        "id, producer_id, days_of_week, periodicity_weeks, start_time, end_time, slot_duration_minutes, capacity_per_slot, active, created_at, updated_at",
      )
      .eq("producer_id", producer.id)
      .order("active", { ascending: false })
      .order("created_at", { ascending: false }),
    admin
      .from("slots")
      .select("id, starts_at, ends_at, capacity_per_slot")
      .eq("producer_id", producer.id)
      .is("rule_id", null)
      .is("excluded_at", null)
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true }),
    admin
      .from("slots")
      .select("id, starts_at, ends_at, rule_id")
      .eq("producer_id", producer.id)
      .not("excluded_at", "is", null)
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true }),
    admin
      .from("slots")
      .select("id, starts_at, ends_at, rule_id")
      .eq("producer_id", producer.id)
      .eq("actif", true)
      .is("excluded_at", null)
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(FUTURE_ACTIVE_SLOTS_LIMIT),
  ]);

  const rules = (rulesRaw ?? []) as unknown as SlotRuleRow[];
  const adHocSlots = (adHocRaw ?? []) as unknown as AdHocSlot[];
  const exceptions = (exceptionsRaw ?? []) as unknown as ExcludedSlot[];
  const futureActiveSlots =
    (futureActiveRaw ?? []) as unknown as FutureActiveSlot[];

  // Slots qui ont une commande active en cours — proactivement désactivés
  // dans le picker ExcludeSlotModal. L'action serveur re-checke de toute
  // façon, c'est du polish UX pour éviter un clic → erreur.
  const slotIds = futureActiveSlots.map((s) => s.id);
  let blockedSlotIds: string[] = [];
  if (slotIds.length > 0) {
    const { data: blockedRaw } = await admin
      .from("orders")
      .select("slot_id")
      .in("slot_id", slotIds)
      .in("statut", ["pending", "confirmed", "ready"]);
    blockedSlotIds = Array.from(
      new Set(
        (blockedRaw ?? [])
          .map((o) => o.slot_id as string | null)
          .filter((id): id is string => id !== null),
      ),
    );
  }

  return (
    <ProducerLayout>
      <div className="mx-auto max-w-5xl px-8 py-10">
        <header className="mb-10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Créneaux
          </div>
          <h1 className="mt-1 font-serif text-[40px] leading-tight text-green-900">
            Vos créneaux de retrait
          </h1>
          <p className="mt-1 text-[14px] text-dark/60">
            Organisez vos ouvertures en 3 niveaux : règles récurrentes,
            ouvertures ponctuelles, absences.
          </p>
        </header>

        <section className="mb-12">
          <div className="mb-4">
            <h2 className="font-serif text-[24px] text-green-900">
              Règles récurrentes
            </h2>
            <p className="mt-1 text-[13px] text-dark/55">
              Ouvertures régulières (ex : mercredi et samedi 9h–12h). Les
              créneaux sont matérialisés automatiquement sur 3 mois.
            </p>
          </div>
          <SlotRulesList rules={rules} />
        </section>

        <section className="mb-12">
          <div className="mb-4">
            <h2 className="font-serif text-[24px] text-green-900">
              Créneaux ponctuels
            </h2>
            <p className="mt-1 text-[13px] text-dark/55">
              Ouvertures exceptionnelles qui ne rentrent pas dans vos règles
              récurrentes.
            </p>
          </div>
          <AdHocSlotsList slots={adHocSlots} />
        </section>

        <section>
          <div className="mb-4">
            <h2 className="font-serif text-[24px] text-green-900">
              Exceptions et absences
            </h2>
            <p className="mt-1 text-[13px] text-dark/55">
              Annulez un créneau spécifique ou une plage pour vos vacances.
              Les clients ne pourront plus réserver les créneaux exclus.
            </p>
          </div>
          <ExceptionsList
            exceptions={exceptions}
            futureActiveSlots={futureActiveSlots}
            blockedSlotIds={blockedSlotIds}
          />
        </section>
      </div>
    </ProducerLayout>
  );
}

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SlotRuleRow } from "@/lib/slots/validators";
import { ProducerLayout } from "../_components/ProducerLayout";
import SlotRulesList from "./_components/SlotRulesList";

export default async function CreneauxPage() {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const admin = createSupabaseAdminClient();
  const { data: producer } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", session.id)
    .maybeSingle();

  if (!producer) {
    // Pas de producer linké → flux onboarding incomplet. Le middleware aurait
    // dû catch, mais on sécurise en renvoyant sur la page d'invitation.
    redirect("/invitation");
  }

  const { data: rulesRaw } = await admin
    .from("slot_rules")
    .select(
      "id, producer_id, days_of_week, periodicity_weeks, start_time, end_time, slot_duration_minutes, capacity_per_slot, active, created_at, updated_at",
    )
    .eq("producer_id", producer.id)
    .order("active", { ascending: false })
    .order("created_at", { ascending: false });

  const rules = (rulesRaw ?? []) as unknown as SlotRuleRow[];

  return (
    <ProducerLayout>
      <div className="mx-auto max-w-5xl px-8 py-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
              Créneaux
            </div>
            <h1 className="mt-1 font-serif text-[40px] leading-tight text-green-900">
              Vos règles de créneaux
            </h1>
            <p className="mt-1 text-[14px] text-dark/60">
              Configurez vos jours et horaires d&apos;ouverture. Les créneaux
              sont matérialisés automatiquement sur 4 semaines glissantes et
              visibles côté client au moment de la commande.
            </p>
          </div>
        </header>

        <SlotRulesList rules={rules} />
      </div>
    </ProducerLayout>
  );
}

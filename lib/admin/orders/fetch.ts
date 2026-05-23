import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatSlotRange,
  formatLegacyTimeHHMM,
} from "@/lib/slots/format-slot-time";
import { formatDateFr } from "@/lib/format/date";
import type { AdminOrder, Status } from "./types";

// Chantier 5 — helper service_role pour le suivi commandes admin. Extraction
// de la query inline de app/(admin)/suivi-commandes/page.tsx (testabilité +
// factorisation, cohérent lib/admin/producers/fetch.ts). 200 dernières
// commandes, mapping raw→AdminOrder interne, fail-safe { rows, error }.

export type FetchAdminOrdersResult = {
  rows: AdminOrder[];
  error: string | null;
};

type RawOrder = {
  id: string;
  code_commande: string | null;
  created_at: string;
  statut: Status;
  closure_reason: string | null;
  montant_total: number | null;
  date_retrait: string | null;
  heure_retrait: string | null;
  consumer:
    | { prenom: string | null; nom: string | null }
    | Array<{ prenom: string | null; nom: string | null }>
    | null;
  producer:
    | { nom_exploitation: string }
    | Array<{ nom_exploitation: string }>
    | null;
  slots:
    | { starts_at: string | null; ends_at: string | null }
    | Array<{ starts_at: string | null; ends_at: string | null }>
    | null;
};

export async function fetchAdminOrdersList(
  admin: SupabaseClient,
): Promise<FetchAdminOrdersResult> {
  const { data, error } = await admin
    .from("orders")
    .select(
      `id, code_commande, created_at, statut, closure_reason, montant_total, date_retrait, heure_retrait,
       consumer:consumer_id ( prenom, nom ),
       producer:producer_id ( nom_exploitation ),
       slots:slot_id ( starts_at, ends_at )`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return { rows: [], error: error.message };
  }

  const rows: AdminOrder[] = ((data ?? []) as unknown as RawOrder[]).map((o) => {
    const consumer = Array.isArray(o.consumer) ? o.consumer[0] : o.consumer;
    const producer = Array.isArray(o.producer) ? o.producer[0] : o.producer;
    const slot = Array.isArray(o.slots) ? o.slots[0] : o.slots;
    const slotTime =
      slot?.starts_at && slot?.ends_at
        ? formatSlotRange(slot.starts_at, slot.ends_at)
        : formatLegacyTimeHHMM(o.heure_retrait);
    return {
      id: o.id,
      code_commande: o.code_commande,
      client:
        [consumer?.prenom, consumer?.nom].filter(Boolean).join(" ").trim() ||
        "Client",
      producer: producer?.nom_exploitation ?? "—",
      created_at: o.created_at,
      date_retrait: o.date_retrait,
      slot_label: `${formatDateFr(o.date_retrait, { year: false })}${
        slotTime ? " " + slotTime : ""
      }`,
      total: Number(o.montant_total ?? 0),
      status: o.statut,
      closure_reason: o.closure_reason,
    };
  });

  return { rows, error: null };
}

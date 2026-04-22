import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// Helpers de formatage pour les créneaux depuis la refonte Phase 1 créneaux
// (migration 20260422300000_slot_rules_and_materialized_slots). Les slots
// stockent désormais starts_at/ends_at (timestamptz). Les `orders.heure_retrait`
// historiques (time HH:MM:SS) restent en fallback via les helpers *Legacy.
//
// Convention d'affichage : "9h" pour les heures pleines, "9h30" sinon.
// Zone de référence : Europe/Paris (aligne sur generate.ts et la DB).

const TZ = "Europe/Paris";

function toParis(iso: string): TZDate {
  return new TZDate(iso, TZ);
}

function formatHM(d: TZDate): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

// ISO timestamptz → "9h" ou "9h30" (Europe/Paris)
export function formatSlotTime(startsAt: string): string {
  return formatHM(toParis(startsAt));
}

// Deux ISO timestamptz → "9h–10h"
export function formatSlotRange(startsAt: string, endsAt: string): string {
  return `${formatSlotTime(startsAt)}–${formatSlotTime(endsAt)}`;
}

// ISO timestamptz → "09:30:00" pour passage à la RPC create_order_with_items
// (qui attend un `time`). Seconde toujours "00" : les slots sont matérialisés
// à la minute.
export function extractHeureRetrait(startsAt: string): string {
  const d = toParis(startsAt);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}:00`;
}

// ISO timestamptz → "Samedi 26 avril à 9h30" (pour tooltip, mails, pages
// partage). La majuscule du jour est ajoutée manuellement (date-fns FR rend
// "samedi" minuscule).
export function formatSlotDateTime(startsAt: string): string {
  const d = toParis(startsAt);
  const dateStr = format(d, "EEEE d MMMM", { locale: fr });
  const cap = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  return `${cap} à ${formatHM(d)}`;
}

// Fallback pour les données legacy `orders.heure_retrait` (string HH:MM ou
// HH:MM:SS) et `slot_rules.start_time`/`end_time` (DB type `time`). Convertit
// en "9h" ou "9h30". Retourne "—" si null ou invalide.
export function formatLegacyTimeHHMM(hmm: string | null): string {
  if (!hmm) return "—";
  const [hRaw, mRaw] = hmm.split(":");
  const h = parseInt(hRaw ?? "", 10);
  const m = parseInt(mRaw ?? "0", 10);
  if (Number.isNaN(h)) return "—";
  const mm = Number.isNaN(m) ? 0 : m;
  return mm === 0 ? `${h}h` : `${h}h${String(mm).padStart(2, "0")}`;
}

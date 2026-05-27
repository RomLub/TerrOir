"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createSlotRuleAction,
  updateSlotRuleAction,
  createAdHocSlotAction,
} from "../actions";
import type { SlotRuleRow } from "@/lib/slots/validators";

// Formulaire unifié d'ajout / modification d'une ouverture (ADR-0012).
// Deux axes en langage simple :
//   - récurrence : « toutes les semaines » (règle) vs « une seule fois » (ponctuel)
//   - mode : « ouverture libre » (1 créneau, X clients) vs « sur rendez-vous »
//     (tranches de 15/30/60 min, X clients par tranche).
// Soumission manuelle (useTransition) car l'action cible dépend de la récurrence.

type Recurrence = "recurring" | "oneoff";
type Mode = "libre" | "rdv";

const WEEK_DAYS: { value: number; short: string }[] = [
  { value: 1, short: "Lun" },
  { value: 2, short: "Mar" },
  { value: 3, short: "Mer" },
  { value: 4, short: "Jeu" },
  { value: 5, short: "Ven" },
  { value: 6, short: "Sam" },
  { value: 0, short: "Dim" },
];

const DURATIONS = [15, 30, 60];

function timeToMin(hm: string): number {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return 0;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

const inputClass =
  "mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700";

export default function OpeningModal({
  initialRecurrence = "recurring",
  editRule,
  defaultDate,
  onClose,
  onSuccess,
}: {
  initialRecurrence?: Recurrence;
  editRule?: SlotRuleRow;
  defaultDate?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = !!editRule;
  const [recurrence, setRecurrence] = useState<Recurrence>(
    isEdit ? "recurring" : initialRecurrence,
  );
  const [days, setDays] = useState<Set<number>>(
    new Set(editRule?.days_of_week ?? [3]),
  );
  const [date, setDate] = useState<string>(defaultDate ?? "");
  const [startTime, setStartTime] = useState<string>(
    (editRule?.start_time ?? "09:00").slice(0, 5),
  );
  const [endTime, setEndTime] = useState<string>(
    (editRule?.end_time ?? "12:00").slice(0, 5),
  );
  const [mode, setMode] = useState<Mode>(editRule?.mode ?? "libre");
  const [duration, setDuration] = useState<number>(
    editRule && editRule.mode === "rdv" ? editRule.slot_duration_minutes : 30,
  );
  const [capacity, setCapacity] = useState<number>(
    editRule?.capacity_per_slot ?? 10,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const toggleDay = (v: number) =>
    setDays((p) => {
      const n = new Set(p);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });

  const amplitude = timeToMin(endTime) - timeToMin(startTime);
  const valid =
    amplitude > 0 &&
    capacity >= 1 &&
    (mode === "libre" || (duration >= 5 && duration <= amplitude)) &&
    (recurrence === "recurring" ? days.size > 0 : date !== "");

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("mode", mode);
    fd.set("capacity_per_slot", String(capacity));
    if (mode === "rdv") fd.set("slot_duration_minutes", String(duration));

    startTransition(async () => {
      let res: { error?: string; success?: boolean };
      if (recurrence === "recurring") {
        for (const d of days) fd.append("days_of_week", String(d));
        fd.set("periodicity_weeks", "1");
        fd.set("start_time", startTime);
        fd.set("end_time", endTime);
        res =
          isEdit && editRule
            ? await updateSlotRuleAction(editRule.id, {}, fd)
            : await createSlotRuleAction({}, fd);
      } else {
        fd.set("start_at", `${date}T${startTime}`);
        fd.set("end_at", `${date}T${endTime}`);
        res = await createAdHocSlotAction({}, fd);
      }
      if (res.error) setError(res.error);
      else if (res.success) onSuccess();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="opening-modal-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-8 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="opening-modal-title"
          className="font-serif text-[28px] leading-tight text-green-900"
        >
          {isEdit ? "Modifier l'ouverture" : "Ajouter une ouverture"}
        </h2>

        <div className="mt-6 space-y-5">
          {/* Récurrence */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["recurring", "Toutes les semaines"],
                  ["oneoff", "Une seule fois"],
                ] as [Recurrence, string][]
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setRecurrence(val)}
                  aria-pressed={recurrence === val}
                  className={`rounded-xl border px-4 py-3 text-[14px] font-medium transition-colors ${
                    recurrence === val
                      ? "border-green-700 bg-green-700 text-white"
                      : "border-dark/10 bg-white text-dark/70 hover:border-green-700/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Jours (récurrent) ou date (ponctuel) */}
          {recurrence === "recurring" ? (
            <div>
              <span className="text-[12px] font-medium text-dark/70">
                Quels jours ?
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEK_DAYS.map((d) => {
                  const selected = days.has(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      aria-pressed={selected}
                      className={`rounded-full border px-4 py-2 text-[13px] font-medium transition-colors ${
                        selected
                          ? "border-green-700 bg-green-700 text-white"
                          : "border-dark/10 bg-white text-dark/70 hover:border-green-700/50"
                      }`}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <label className="block">
              <span className="text-[12px] font-medium text-dark/70">
                Quel jour ?
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
              />
            </label>
          )}

          {/* Horaires */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] font-medium text-dark/70">De</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-dark/70">À</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          {/* Mode */}
          <div>
            <span className="text-[12px] font-medium text-dark/70">
              Comment les clients récupèrent leur commande ?
            </span>
            <div className="mt-2 grid gap-2">
              <button
                type="button"
                onClick={() => setMode("libre")}
                aria-pressed={mode === "libre"}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  mode === "libre"
                    ? "border-green-700 bg-green-100/60"
                    : "border-dark/10 hover:border-green-700/50"
                }`}
              >
                <div className="text-[14px] font-semibold text-green-900">
                  Ouverture libre
                </div>
                <div className="text-[12px] text-dark/60">
                  Les clients passent quand ils veulent pendant le créneau.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode("rdv")}
                aria-pressed={mode === "rdv"}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  mode === "rdv"
                    ? "border-green-700 bg-green-100/60"
                    : "border-dark/10 hover:border-green-700/50"
                }`}
              >
                <div className="text-[14px] font-semibold text-green-900">
                  Sur rendez-vous
                </div>
                <div className="text-[12px] text-dark/60">
                  Chaque client choisit une heure précise.
                </div>
              </button>
            </div>
          </div>

          {/* Détails selon le mode */}
          <div className="grid grid-cols-2 gap-3">
            {mode === "rdv" && (
              <label className="block">
                <span className="text-[12px] font-medium text-dark/70">
                  Un rendez-vous toutes les
                </span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                  className={inputClass}
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} min
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-[12px] font-medium text-dark/70">
                {mode === "rdv"
                  ? "Clients par rendez-vous"
                  : "Clients maximum"}
              </span>
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(parseInt(e.target.value, 10) || 0)}
                className={inputClass}
              />
            </label>
          </div>

          {error ? (
            <p className="text-[13px] text-terra-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-[14px] text-dark/70 transition-colors hover:bg-dark/5 hover:text-dark"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!valid || pending}
              className="rounded-md bg-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

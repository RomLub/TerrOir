"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  createSlotRuleAction,
  updateSlotRuleAction,
  type SlotRuleActionState,
} from "../actions";
import type { SlotRuleRow } from "@/lib/slots/validators";

const INITIAL: SlotRuleActionState = {};

// Convention postgres : dimanche=0..samedi=6. Présentation lundi-first.
const WEEK_DAYS: { value: number; short: string; full: string }[] = [
  { value: 1, short: "Lun", full: "Lundi" },
  { value: 2, short: "Mar", full: "Mardi" },
  { value: 3, short: "Mer", full: "Mercredi" },
  { value: 4, short: "Jeu", full: "Jeudi" },
  { value: 5, short: "Ven", full: "Vendredi" },
  { value: 6, short: "Sam", full: "Samedi" },
  { value: 0, short: "Dim", full: "Dimanche" },
];

function timeToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return 0;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

// Preview : combien de créneaux seront générés sur 4 semaines glissantes
// avec la config courante. Formule pure (miroir de generate.ts, sans les
// filtres de date) : daysSelected × slotsPerDay × cyclesIn4Weeks.
function previewSlotCount(
  daysOfWeek: Set<number>,
  periodicity: number,
  startTime: string,
  endTime: string,
  duration: number,
): number {
  if (daysOfWeek.size === 0) return 0;
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  if (endMin <= startMin) return 0;
  if (duration <= 0) return 0;
  const slotsPerDay = Math.floor((endMin - startMin) / duration);
  if (slotsPerDay <= 0) return 0;
  const period = Math.max(1, periodicity);
  const cyclesIn4Weeks = Math.ceil(4 / period);
  return daysOfWeek.size * slotsPerDay * cyclesIn4Weeks;
}

export default function SlotRuleModal({
  mode,
  initialRule,
  onClose,
  onSuccess,
}: {
  mode: "create" | "edit";
  initialRule?: SlotRuleRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const action =
    mode === "edit" && initialRule
      ? updateSlotRuleAction.bind(null, initialRule.id)
      : createSlotRuleAction;

  const [state, formAction] = useFormState(action, INITIAL);

  const [daysOfWeek, setDaysOfWeek] = useState<Set<number>>(
    new Set(initialRule?.days_of_week ?? []),
  );
  const [periodicity, setPeriodicity] = useState<number>(
    initialRule?.periodicity_weeks ?? 1,
  );
  const [startTime, setStartTime] = useState<string>(
    (initialRule?.start_time ?? "09:00").slice(0, 5),
  );
  const [endTime, setEndTime] = useState<string>(
    (initialRule?.end_time ?? "12:00").slice(0, 5),
  );
  const [duration, setDuration] = useState<number>(
    initialRule?.slot_duration_minutes ?? 30,
  );
  const [capacity, setCapacity] = useState<number>(
    initialRule?.capacity_per_slot ?? 1,
  );

  const firstInputRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (state.success) onSuccess();
  }, [state.success, onSuccess]);

  const preview = useMemo(
    () =>
      previewSlotCount(daysOfWeek, periodicity, startTime, endTime, duration),
    [daysOfWeek, periodicity, startTime, endTime, duration],
  );

  const toggleDay = (value: number) => {
    setDaysOfWeek((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const clientValid =
    daysOfWeek.size > 0 &&
    timeToMinutes(endTime) > timeToMinutes(startTime) &&
    duration >= 5 &&
    duration <= timeToMinutes(endTime) - timeToMinutes(startTime) &&
    capacity >= 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="slot-rule-modal-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-8 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="slot-rule-modal-title"
          className="font-serif text-[28px] leading-tight text-green-900"
        >
          {mode === "create" ? "Nouvelle règle de créneaux" : "Modifier la règle"}
        </h2>
        <p className="mt-1 text-[13px] text-dark/60">
          Configurez les jours et horaires. Les créneaux seront générés
          automatiquement sur 4 semaines glissantes.
        </p>

        <form action={formAction} className="mt-6 space-y-5" noValidate>
          {daysOfWeek.size === 0 ? null : (
            [...daysOfWeek].map((d) => (
              <input
                key={d}
                type="hidden"
                name="days_of_week"
                value={String(d)}
              />
            ))
          )}

          <div>
            <span className="text-[12px] font-medium text-dark/70">
              Jours de la semaine
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEK_DAYS.map((d, i) => {
                const selected = daysOfWeek.has(d.value);
                return (
                  <button
                    key={d.value}
                    ref={i === 0 ? firstInputRef : undefined}
                    type="button"
                    onClick={() => toggleDay(d.value)}
                    className={`rounded-full border px-4 py-2 text-[13px] font-medium transition-colors ${
                      selected
                        ? "border-green-700 bg-green-700 text-white"
                        : "border-dark/10 bg-white text-dark/70 hover:border-green-700/50"
                    }`}
                    aria-pressed={selected}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">
              Périodicité
            </span>
            <select
              name="periodicity_weeks"
              value={periodicity}
              onChange={(e) => setPeriodicity(parseInt(e.target.value, 10))}
              className="mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
            >
              <option value={1}>Toutes les semaines</option>
              <option value={2}>Toutes les 2 semaines</option>
              <option value={3}>Toutes les 3 semaines</option>
              <option value={4}>Toutes les 4 semaines</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] font-medium text-dark/70">
                Début
              </span>
              <input
                name="start_time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-dark/70">Fin</span>
              <input
                name="end_time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] font-medium text-dark/70">
                Durée d&apos;un créneau (min)
              </span>
              <input
                name="slot_duration_minutes"
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) =>
                  setDuration(parseInt(e.target.value, 10) || 0)
                }
                required
                className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-dark/70">
                Capacité par créneau
              </span>
              <input
                name="capacity_per_slot"
                type="number"
                min={1}
                value={capacity}
                onChange={(e) =>
                  setCapacity(parseInt(e.target.value, 10) || 0)
                }
                required
                className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
              />
            </label>
          </div>

          <div className="rounded-xl bg-green-100/60 border border-green-300/40 p-3 text-[13px] text-green-900">
            <span className="font-semibold">~{preview}</span>{" "}
            créneau{preview > 1 ? "x" : ""} sur 4 semaines glissantes
          </div>

          {state.error ? (
            <p className="text-[13px] text-terra-700" role="alert">
              {state.error}
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
            <SaveButton clientValid={clientValid} mode={mode} />
          </div>
        </form>
      </div>
    </div>
  );
}

function SaveButton({
  clientValid,
  mode,
}: {
  clientValid: boolean;
  mode: "create" | "edit";
}) {
  const { pending } = useFormStatus();
  const label = mode === "create" ? "Créer la règle" : "Enregistrer";
  return (
    <button
      type="submit"
      disabled={!clientValid || pending}
      className="rounded-md bg-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Enregistrement…" : label}
    </button>
  );
}

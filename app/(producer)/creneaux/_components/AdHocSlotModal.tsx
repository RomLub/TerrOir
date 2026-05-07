"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createAdHocSlotAction,
  type SlotRuleActionState,
} from "../actions";

const INITIAL: SlotRuleActionState = {};

// Fallback datetime-local "YYYY-MM-DDTHH:MM" : demain 09:00 locale browser.
// Juste une valeur raisonnable pour éviter le placeholder vide.
function tomorrowAt9(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdHocSlotModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [state, formAction] = useActionState(createAdHocSlotAction, INITIAL);
  const defaultStart = tomorrowAt9();
  const [startAt, setStartAt] = useState(defaultStart);
  const [endAt, setEndAt] = useState(() => {
    const d = new Date(defaultStart);
    d.setHours(d.getHours() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [capacity, setCapacity] = useState(1);

  const firstInputRef = useRef<HTMLInputElement>(null);
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

  const clientValid = endAt > startAt && capacity >= 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="adhoc-slot-modal-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-8 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="adhoc-slot-modal-title"
          className="font-serif text-[28px] leading-tight text-green-900"
        >
          Nouveau créneau ponctuel
        </h2>
        <p className="mt-1 text-[13px] text-dark/60">
          Un créneau one-shot (ex : ouverture exceptionnelle). Il n&apos;est
          pas lié à une règle récurrente.
        </p>

        <form action={formAction} className="mt-6 space-y-4" noValidate>
          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">Début</span>
            <input
              ref={firstInputRef}
              name="start_at"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              required
              className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">Fin</span>
            <input
              name="end_at"
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              required
              className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">
              Capacité
            </span>
            <input
              name="capacity_per_slot"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(parseInt(e.target.value, 10) || 0)}
              required
              className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
            />
          </label>

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
            <SaveButton disabled={!clientValid} />
          </div>
        </form>
      </div>
    </div>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-md bg-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-green-700/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Création…" : "Créer le créneau"}
    </button>
  );
}

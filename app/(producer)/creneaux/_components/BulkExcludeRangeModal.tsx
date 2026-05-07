"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  bulkExcludeRangeAction,
  type BulkExcludeRangeState,
} from "../actions";

const INITIAL: BulkExcludeRangeState = {};

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function BulkExcludeRangeModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [state, formAction] = useActionState(bulkExcludeRangeAction, INITIAL);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
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
    if (!state.success) return;
    const excluded = state.count_excluded ?? 0;
    const skipped = state.count_skipped_orders ?? 0;
    const plural = (n: number, s: string, p: string) => (n > 1 ? p : s);

    let message: string;
    if (excluded === 0 && skipped === 0) {
      message = "Aucun créneau à annuler sur cette plage.";
    } else if (excluded > 0 && skipped === 0) {
      message = `${excluded} créneau${plural(excluded, "", "x")} annulé${plural(excluded, "", "s")} pour cette plage.`;
    } else if (excluded === 0 && skipped > 0) {
      message =
        `Aucun créneau annulé. Les ${skipped} créneaux de cette plage ont des commandes actives. ` +
        `Annulez d'abord ces commandes.`;
    } else {
      // excluded > 0 && skipped > 0
      message =
        `${excluded} créneau${plural(excluded, "", "x")} annulé${plural(excluded, "", "s")} pour cette plage. ` +
        `${skipped} créneau${plural(skipped, "", "x")} non annulé${plural(skipped, "", "s")} : des commandes actives sont en cours. ` +
        `Annulez d'abord ces commandes si vous voulez libérer ces créneaux.`;
    }
    onSuccess(message);
  }, [state.success, state.count_excluded, state.count_skipped_orders, onSuccess]);

  const clientValid = endDate >= startDate;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-exclude-modal-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-8 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="bulk-exclude-modal-title"
          className="font-serif text-[28px] leading-tight text-green-900"
        >
          Annuler une plage
        </h2>
        <p className="mt-1 text-[13px] text-dark/60">
          Tous les créneaux dans cette plage seront exclus. Les créneaux ayant
          une commande active seront ignorés.
        </p>

        <form action={formAction} className="mt-6 space-y-4" noValidate>
          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">
              Date de début
            </span>
            <input
              ref={firstInputRef}
              name="start_date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">
              Date de fin (incluse)
            </span>
            <input
              name="end_date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
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
      className="rounded-md bg-terra-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terra-700/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Exclusion…" : "Exclure la plage"}
    </button>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { TZDate } from "@date-fns/tz";
import {
  formatSlotDateTime,
  formatSlotRange,
} from "@/lib/slots/format-slot-time";
import { excludeSlotAction } from "../actions";

export interface FutureActiveSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  rule_id: string | null;
}

const TZ_PARIS = "Europe/Paris";

// Extrait "YYYY-MM-DD" en Europe/Paris depuis un ISO timestamptz. Utilisé
// pour matcher un slot.starts_at au date-input sélectionné par le producer.
function slotDateInParis(iso: string): string {
  const d = new TZDate(iso, TZ_PARIS);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function horizonMaxISO(horizonDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + horizonDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ExcludeSlotModal({
  activeSlots,
  blockedSlotIds,
  onClose,
  onSuccess,
}: {
  activeSlots: FutureActiveSlot[];
  blockedSlotIds: string[];
  onClose: () => void;
  onSuccess: (slotLabel: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dateInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const blockedSet = useMemo(
    () => new Set(blockedSlotIds),
    [blockedSlotIds],
  );

  const minDate = todayISO();
  const maxDate = horizonMaxISO(90);

  const slotsForDay = useMemo(
    () =>
      activeSlots.filter((s) => slotDateInParis(s.starts_at) === selectedDate),
    [activeSlots, selectedDate],
  );

  const handleExclude = (slot: FutureActiveSlot) => {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await excludeSlotAction(slot.id);
      if ("error" in res) {
        setErrorMessage(res.error);
        return;
      }
      onSuccess(formatSlotDateTime(slot.starts_at));
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="exclude-slot-modal-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-8 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="exclude-slot-modal-title"
          className="font-serif text-[28px] leading-tight text-green-900"
        >
          Annuler un créneau
        </h2>
        <p className="mt-1 text-[13px] text-dark/60">
          Choisissez la date, puis le créneau à exclure. Il ne sera plus
          réservable par les clients. Vous pourrez le rétablir plus tard.
        </p>

        <label className="mt-5 block">
          <span className="text-[12px] font-medium text-dark/70">Date</span>
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            min={minDate}
            max={maxDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
          />
        </label>

        <div className="mt-5">
          {slotsForDay.length === 0 ? (
            <p className="rounded-xl bg-bg/60 py-6 text-center text-[13px] text-dark/55">
              Aucun créneau à exclure ce jour-là.
            </p>
          ) : (
            <ul className="space-y-2">
              {slotsForDay.map((s) => {
                const blocked = blockedSet.has(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-xl border border-dark/[0.06] bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="mono text-[14px] text-green-900">
                        {formatSlotRange(s.starts_at, s.ends_at)}
                      </span>
                      <span className="text-[11px] text-dark/45">
                        {s.rule_id ? "Règle récurrente" : "Ponctuel"}
                        {blocked ? " · Commande active" : ""}
                      </span>
                    </div>
                    {blocked ? (
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed rounded-md border border-dark/10 px-3 py-1.5 text-[13px] text-dark/40"
                        title="Annulez d'abord la commande liée à ce créneau."
                      >
                        Bloqué
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleExclude(s)}
                        className="rounded-md bg-terra-700 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-terra-700/90"
                      >
                        Exclure
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {errorMessage ? (
          <p className="mt-3 text-[13px] text-terra-700" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[14px] text-dark/70 transition-colors hover:bg-dark/5 hover:text-dark"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

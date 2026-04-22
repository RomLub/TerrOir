"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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

// Regroupe les slots par jour calendaire (ISO YYYY-MM-DD extrait de starts_at,
// simple slice — l'affichage ordonné suffit, pas besoin de TZ précise ici).
function groupByDate(slots: FutureActiveSlot[]): Map<string, FutureActiveSlot[]> {
  const map = new Map<string, FutureActiveSlot[]>();
  for (const s of slots) {
    const key = s.starts_at.slice(0, 10);
    const arr = map.get(key);
    if (arr) arr.push(s);
    else map.set(key, [s]);
  }
  return map;
}

export default function ExcludeSlotModal({
  activeSlots,
  onClose,
  onSuccess,
}: {
  activeSlots: FutureActiveSlot[];
  onClose: () => void;
  onSuccess: (slotLabel: string) => void;
}) {
  const [dateFilter, setDateFilter] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const grouped = useMemo(() => groupByDate(activeSlots), [activeSlots]);

  const filtered = useMemo(() => {
    if (!dateFilter) return grouped;
    const filteredMap = new Map<string, FutureActiveSlot[]>();
    const slots = grouped.get(dateFilter);
    if (slots) filteredMap.set(dateFilter, slots);
    return filteredMap;
  }, [grouped, dateFilter]);

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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-8 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="exclude-slot-modal-title"
          className="font-serif text-[28px] leading-tight text-green-900"
        >
          Annuler un créneau
        </h2>
        <p className="mt-1 text-[13px] text-dark/60">
          Sélectionnez un créneau actif à exclure. Il ne sera plus réservable
          par les clients. Vous pourrez le rétablir plus tard.
        </p>

        <div className="mt-5">
          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">
              Filtrer par date (optionnel)
            </span>
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="mono mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
            />
          </label>
          {dateFilter ? (
            <button
              type="button"
              onClick={() => setDateFilter("")}
              className="mt-2 text-[12px] text-dark/60 hover:text-dark"
            >
              Effacer le filtre
            </button>
          ) : null}
        </div>

        <div className="mt-5 max-h-[45vh] overflow-y-auto rounded-xl border border-dark/[0.06] bg-bg/40 p-2">
          {filtered.size === 0 ? (
            <p className="py-6 text-center text-[13px] text-dark/50">
              Aucun créneau {dateFilter ? "à cette date." : "actif futur."}
            </p>
          ) : (
            [...filtered.entries()].map(([date, slots]) => (
              <div key={date} className="mb-3 last:mb-0">
                <div className="mono mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-dark/50">
                  {date}
                </div>
                <ul className="space-y-1">
                  {slots.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="mono text-[13px] text-green-900">
                          {formatSlotRange(s.starts_at, s.ends_at)}
                        </span>
                        <span className="text-[11px] text-dark/45">
                          {s.rule_id ? "Règle récurrente" : "Ponctuel"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleExclude(s)}
                        className="text-[13px] text-terra-700 hover:underline"
                      >
                        Exclure
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
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

"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createUnavailabilitiesAction,
  deleteUnavailabilityAction,
} from "../actions";
import type {
  BlockingOrderForUnavail,
  CreateUnavailabilitiesResult,
} from "@/lib/unavailabilities/types";
import {
  MonthCalendar,
  todayParisKey,
  type MonthCalendarCell,
} from "./_month-calendar";

// Modale de pose / suppression d'indispos producteur (PR #2, ADR-0016).
// 5 états de cellule (cf. maquette validée 2026-05-28) :
//   - jour passé : grisé non-cliquable, cadenas.
//   - jour avec créneaux configurés : point terra sous le chiffre.
//   - jour sélectionné (à poser) : fond terra plein.
//   - jour déjà indispo : bordure pointillée terra + cadenas. Clic → mini
//     confirmation de suppression.
//   - jour avec commandes actives : grisé NON-CLIQUABLE, icône panier
//     ambre, tooltip explicite. Aucun flow d'annulation : pour fermer un
//     jour à commandes, le producteur doit d'abord annuler depuis
//     /commandes. Geste délibéré, ne pas banaliser la rupture
//     d'engagement client.
//
// Retour BLOCKING_ORDERS du serveur (PR #1) sert de filet de sécurité :
// si malgré le blocage UI une requête arrive, on affiche un message
// d'erreur explicite — pas une modale d'annulation.

type Props = {
  /** Indispos déjà posées (clés YYYY-MM-DD Europe/Paris) — clic = suppression. */
  unavailableDates: Set<string>;
  /** Jours ayant des créneaux configurés (clés YYYY-MM-DD). */
  datesWithSlots: Set<string>;
  /** Jours portant ≥1 commande active. NON-CLIQUABLES. */
  datesWithActiveOrders: Set<string>;
  /** Map id d'indispo par dateKey (pour suppression). */
  unavailabilityIdByDate: Map<string, string>;
  onClose: () => void;
  onSuccess: () => void;
};

export default function UnavailabilitiesCalendarModal({
  unavailableDates,
  datesWithSlots,
  datesWithActiveOrders,
  unavailabilityIdByDate,
  onClose,
  onSuccess,
}: Props) {
  const today = useMemo(() => todayParisKey(), []);

  const initialMonth = useMemo(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y!, month0: (m ?? 1) - 1 };
  }, [today]);

  const [{ year, month0 }, setMonth] = useState(initialMonth);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [raison, setRaison] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blockingMessage, setBlockingMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleSelect(dateKey: string) {
    setError(null);
    setBlockingMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  function submit() {
    if (selected.size === 0) return;
    setError(null);
    setBlockingMessage(null);
    const fd = new FormData();
    for (const d of selected) fd.append("dates", d);
    if (raison.trim().length > 0) fd.set("raison", raison.trim());

    startTransition(async () => {
      const res: CreateUnavailabilitiesResult =
        await createUnavailabilitiesAction(null, fd);
      if ("success" in res) {
        onSuccess();
        return;
      }
      if (res.code === "BLOCKING_ORDERS" && res.blocking_orders) {
        setBlockingMessage(formatBlockingMessage(res.blocking_orders));
      } else {
        setError(res.error);
      }
    });
  }

  function confirmDelete(dateKey: string) {
    const id = unavailabilityIdByDate.get(dateKey);
    if (!id) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteUnavailabilityAction(id);
      if ("success" in res) {
        setPendingDelete(null);
        onSuccess();
        return;
      }
      setError(res.error);
      setPendingDelete(null);
    });
  }

  const sortedSelection = useMemo(
    () => Array.from(selected).sort(),
    [selected],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="unavail-modal-title"
    >
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="unavail-modal-title"
          className="font-serif text-[22px] leading-tight text-green-900"
        >
          Indisponibilité
        </h2>
        <p className="mt-1 text-[13px] text-dark/60">
          Sélectionnez les jours où vous n&rsquo;êtes pas disponible.
        </p>

        <div className="mt-5">
          <MonthCalendar
            year={year}
            month0={month0}
            onChangeMonth={(y, m) => setMonth({ year: y, month0: m })}
            renderCell={(cell) => (
              <Cell
                cell={cell}
                today={today}
                isInDisplayedMonth={cell.inMonth}
                isSelected={selected.has(cell.dateKey)}
                hasSlots={datesWithSlots.has(cell.dateKey)}
                isUnavailable={unavailableDates.has(cell.dateKey)}
                hasActiveOrders={datesWithActiveOrders.has(cell.dateKey)}
                pendingDelete={pendingDelete === cell.dateKey}
                onToggle={() => toggleSelect(cell.dateKey)}
                onAskDelete={() => setPendingDelete(cell.dateKey)}
                onConfirmDelete={() => confirmDelete(cell.dateKey)}
                onCancelDelete={() => setPendingDelete(null)}
              />
            )}
          />
        </div>

        <div className="mt-4 rounded-xl bg-bg/40 p-3 text-[11px] text-dark/60">
          <Legend />
        </div>

        {sortedSelection.length > 0 ? (
          <div className="mt-4">
            <div className="text-[12px] font-semibold text-dark/70">
              {sortedSelection.length}{" "}
              {sortedSelection.length > 1 ? "jours sélectionnés" : "jour sélectionné"}
            </div>
            <label className="mt-3 block">
              <span className="text-[12px] font-medium text-dark/70">
                Raison{" "}
                <span className="font-normal text-dark/40">
                  (facultatif — visible uniquement par vous)
                </span>
              </span>
              <textarea
                value={raison}
                onChange={(e) => setRaison(e.target.value)}
                maxLength={280}
                rows={2}
                className="mt-1 w-full rounded-xl border border-dark/10 bg-white px-3 py-2 text-[14px] outline-none focus:border-green-700"
                placeholder="Congés d'été, rendez-vous, etc."
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 text-[13px] text-terra-700" role="alert">
            {error}
          </p>
        ) : null}
        {blockingMessage ? (
          <div
            className="mt-3 rounded-xl border border-amber-500/40 bg-amber-50 p-3 text-[13px] text-amber-900"
            role="alert"
          >
            {blockingMessage}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-[14px] text-dark/70 transition-colors hover:bg-dark/5"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={selected.size === 0 || pending}
            className="rounded-md bg-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-green-700/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "…" : "Poser indispo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Cell({
  cell,
  today,
  isInDisplayedMonth,
  isSelected,
  hasSlots,
  isUnavailable,
  hasActiveOrders,
  pendingDelete,
  onToggle,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  cell: MonthCalendarCell;
  today: string;
  isInDisplayedMonth: boolean;
  isSelected: boolean;
  hasSlots: boolean;
  isUnavailable: boolean;
  hasActiveOrders: boolean;
  pendingDelete: boolean;
  onToggle: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const isPast = cell.dateKey < today;
  const disabled = isPast || hasActiveOrders;

  if (pendingDelete && isUnavailable) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center rounded-md border border-terra-700 bg-terra-700/10 p-1 text-[10px] leading-tight">
        <button
          type="button"
          onClick={onConfirmDelete}
          className="rounded bg-terra-700 px-1.5 py-0.5 text-[10px] font-semibold text-white"
        >
          Retirer
        </button>
        <button
          type="button"
          onClick={onCancelDelete}
          className="mt-0.5 text-[10px] text-dark/60 underline"
        >
          Annuler
        </button>
      </div>
    );
  }

  const baseClass =
    "flex aspect-square w-full flex-col items-center justify-center rounded-md border text-[14px] transition-colors relative";
  let stateClass = "border-dark/[0.08] bg-white text-dark/80 hover:border-green-700/40";
  let tooltip = "Cliquer pour sélectionner";

  if (!isInDisplayedMonth) {
    stateClass = "border-transparent text-dark/20";
    tooltip = "";
  } else if (isPast) {
    stateClass =
      "border-transparent bg-dark/[0.04] text-dark/30 cursor-not-allowed";
    tooltip = "Jour passé";
  } else if (hasActiveOrders) {
    stateClass =
      "border-amber-300 bg-amber-50 text-amber-700/60 cursor-not-allowed";
    tooltip =
      "Ce jour contient des commandes à honorer. Annulez-les depuis « Commandes » avant de poser l'indisponibilité.";
  } else if (isUnavailable) {
    stateClass =
      "border-dashed border-terra-700 bg-terra-700/5 text-terra-700 hover:bg-terra-700/10";
    tooltip = "Indisponibilité posée — cliquer pour la retirer";
  } else if (isSelected) {
    stateClass = "border-terra-700 bg-terra-700 text-white";
    tooltip = "Sélectionné — cliquer pour désélectionner";
  }

  function handleClick() {
    if (!isInDisplayedMonth) return;
    if (isPast || hasActiveOrders) return;
    if (isUnavailable) {
      onAskDelete();
      return;
    }
    onToggle();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || !isInDisplayedMonth}
      title={tooltip}
      aria-label={cellAriaLabel({
        dateKey: cell.dateKey,
        isPast,
        hasActiveOrders,
        isUnavailable,
        isSelected,
      })}
      className={`${baseClass} ${stateClass}`}
    >
      <span className="leading-none">{cell.dayNum}</span>
      <CellIcons
        isPast={isPast}
        hasSlots={hasSlots}
        hasActiveOrders={hasActiveOrders}
        isUnavailable={isUnavailable}
        isInDisplayedMonth={isInDisplayedMonth}
      />
    </button>
  );
}

function CellIcons({
  isPast,
  hasSlots,
  hasActiveOrders,
  isUnavailable,
  isInDisplayedMonth,
}: {
  isPast: boolean;
  hasSlots: boolean;
  hasActiveOrders: boolean;
  isUnavailable: boolean;
  isInDisplayedMonth: boolean;
}) {
  if (!isInDisplayedMonth) return null;
  if (isPast) return <Lock />;
  if (isUnavailable) return <Lock />;
  if (hasActiveOrders) return <ShoppingBag />;
  if (hasSlots) {
    return (
      <span
        className="mt-0.5 h-1 w-1 rounded-full bg-terra-700"
        aria-hidden="true"
      />
    );
  }
  return null;
}

function Lock() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      className="mt-0.5 h-2.5 w-2.5"
      fill="currentColor"
    >
      <path d="M4 6V4a3 3 0 016 0v2h1v6H3V6h1zm1 0h4V4a2 2 0 00-4 0v2z" />
    </svg>
  );
}

function ShoppingBag() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      className="mt-0.5 h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M3 4h8l-.7 8H3.7L3 4z" strokeLinejoin="round" />
      <path d="M5 4V3a2 2 0 014 0v1" strokeLinecap="round" />
    </svg>
  );
}

function Legend() {
  return (
    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      <li className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-dark/[0.08] bg-white text-[10px] text-dark/80">
          15
          <span className="ml-0.5 inline-block h-1 w-1 rounded-full bg-terra-700" />
        </span>
        Créneaux configurés ce jour
      </li>
      <li className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-terra-700 bg-terra-700 text-[10px] text-white">
          15
        </span>
        Jour sélectionné
      </li>
      <li className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-dashed border-terra-700 bg-terra-700/5 text-[10px] text-terra-700">
          15
        </span>
        Indisponibilité posée
      </li>
      <li className="flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-amber-300 bg-amber-50 text-[10px] text-amber-700">
          15
        </span>
        Commandes à honorer
      </li>
      <li className="flex items-center gap-2 sm:col-span-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent bg-dark/[0.04] text-[10px] text-dark/30">
          15
        </span>
        Jour passé
      </li>
    </ul>
  );
}

function cellAriaLabel({
  dateKey,
  isPast,
  hasActiveOrders,
  isUnavailable,
  isSelected,
}: {
  dateKey: string;
  isPast: boolean;
  hasActiveOrders: boolean;
  isUnavailable: boolean;
  isSelected: boolean;
}): string {
  const date = dateKey;
  if (isPast) return `${date} — jour passé`;
  if (hasActiveOrders) return `${date} — commandes actives, non sélectionnable`;
  if (isUnavailable) return `${date} — indisponibilité posée, cliquer pour retirer`;
  if (isSelected) return `${date} — sélectionné`;
  return `${date} — disponible`;
}

function formatBlockingMessage(orders: BlockingOrderForUnavail[]): string {
  const dates = new Set(orders.map((o) => o.date_key));
  const dateList = Array.from(dates).sort().join(", ");
  return `Des commandes actives bloquent la pose de l'indisponibilité (${dateList}). Annulez-les depuis « Commandes » avant de réessayer.`;
}

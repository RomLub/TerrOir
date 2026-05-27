"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WeekNavigator } from "../../_components/WeekNavigator";
import type { SlotRuleRow } from "@/lib/slots/validators";
import type { CalendarBlock, CalendarDay } from "@/lib/slots/group-week-slots";
import {
  deleteSlotRuleAction,
  deleteAdHocOpeningAction,
  excludeSlotsByIdsAction,
  unexcludeSlotsByIdsAction,
  bulkExcludeRangeAction,
} from "../actions";
import OpeningModal from "./OpeningModal";

// Calendrier hebdomadaire des ouvertures (ADR-0012). Une grille 7 jours, des
// blocs colorés par ouverture, et 3 gestes : ajouter (régulier/ponctuel),
// fermer ponctuellement / vacances, supprimer. Langage non technique.

type ActionResult = { error?: string; success?: boolean };

type ModalState =
  | { type: "create"; recurrence: "recurring" | "oneoff"; date?: string }
  | { type: "edit"; rule: SlotRuleRow }
  | { type: "vacation" }
  | null;

function blockClasses(block: CalendarBlock): string {
  if (block.excluded) {
    return "border-dark/10 bg-dark/[0.03] text-dark/40 line-through";
  }
  if (block.kind === "recurring") {
    return "border-green-700/30 bg-green-700/10 text-green-900 hover:border-green-700/60";
  }
  return "border-terra-700/30 bg-terra-700/10 text-green-900 hover:border-terra-700/60";
}

function modeLabel(block: CalendarBlock): string {
  if (block.mode === "rdv") return `sur RDV · ${block.slotCount} créneaux`;
  return `${block.capacity} ${block.capacity > 1 ? "places" : "place"}`;
}

export default function CreneauxCalendarClient({
  weekOffset,
  periodLabel,
  days,
  rules,
}: {
  weekOffset: number;
  periodLabel: string;
  days: CalendarDay[];
  rules: SlotRuleRow[];
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [menu, setMenu] = useState<{ block: CalendarBlock; dateKey: string } | null>(
    null,
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      const res = await fn();
      setMenu(null);
      if (res.error) {
        setFlash(res.error);
      } else {
        setFlash(null);
        router.refresh();
      }
    });
  }

  function onSuccess() {
    setModal(null);
    setFlash(null);
    router.refresh();
  }

  return (
    <div>
      {/* Barre d'actions */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <WeekNavigator weekOffset={weekOffset} periodLabel={periodLabel} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setModal({ type: "create", recurrence: "recurring" })}
            className="rounded-lg bg-green-700 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-green-700/90"
          >
            + Ouverture régulière
          </button>
          <button
            type="button"
            onClick={() => setModal({ type: "create", recurrence: "oneoff" })}
            className="rounded-lg border border-green-700 px-4 py-2 text-[13px] font-semibold text-green-900 transition-colors hover:bg-green-100/50"
          >
            + Ponctuelle
          </button>
          <button
            type="button"
            onClick={() => setModal({ type: "vacation" })}
            className="rounded-lg border border-dark/15 px-4 py-2 text-[13px] font-medium text-dark/70 transition-colors hover:border-terra-700/50 hover:text-terra-700"
          >
            Poser des vacances
          </button>
        </div>
      </div>

      {flash ? (
        <p className="mb-4 rounded-lg bg-terra-700/10 px-4 py-2 text-[13px] text-terra-700">
          {flash}
        </p>
      ) : null}

      {/* Grille semaine */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => (
          <div
            key={day.dateKey}
            className={`flex min-h-[160px] flex-col rounded-xl border p-2 ${
              day.isToday
                ? "border-green-500 bg-green-100/40"
                : "border-dark/[0.08] bg-white"
            }`}
          >
            <div className="mb-2 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-dark/50">
                {day.weekdayLabel}
              </div>
              <div
                className={`text-[16px] font-serif ${
                  day.isToday ? "text-green-700" : "text-green-900"
                }`}
              >
                {day.dayNum}
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-1.5">
              {day.blocks.map((block) => (
                <button
                  key={block.key}
                  type="button"
                  onClick={() => setMenu({ block, dateKey: day.dateKey })}
                  className={`rounded-lg border px-2 py-1.5 text-left text-[12px] transition-colors ${blockClasses(
                    block,
                  )}`}
                >
                  <div className="font-semibold leading-tight">{block.label}</div>
                  <div className="text-[10px] opacity-80">
                    {block.excluded ? "Fermé" : modeLabel(block)}
                  </div>
                </button>
              ))}

              <button
                type="button"
                onClick={() =>
                  setModal({
                    type: "create",
                    recurrence: "oneoff",
                    date: day.dateKey,
                  })
                }
                className="mt-auto rounded-lg border border-dashed border-dark/15 py-1 text-[16px] leading-none text-dark/30 transition-colors hover:border-green-700/40 hover:text-green-700"
                aria-label={`Ajouter une ouverture le ${day.dateKey}`}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Menu contextuel d'un bloc */}
      {menu ? (
        <BlockMenu
          block={menu.block}
          pending={pending}
          onClose={() => setMenu(null)}
          onEdit={() => {
            const rule = rules.find((r) => r.id === menu.block.ruleId);
            setMenu(null);
            if (rule) setModal({ type: "edit", rule });
          }}
          onCloseDay={() =>
            run(() => excludeSlotsByIdsAction(menu.block.slotIds))
          }
          onReopen={() =>
            run(() => unexcludeSlotsByIdsAction(menu.block.slotIds))
          }
          onDelete={() =>
            run(() =>
              menu.block.kind === "recurring" && menu.block.ruleId
                ? deleteSlotRuleAction(menu.block.ruleId)
                : deleteAdHocOpeningAction(menu.block.slotIds),
            )
          }
        />
      ) : null}

      {/* Modale d'ajout / édition */}
      {modal?.type === "create" ? (
        <OpeningModal
          initialRecurrence={modal.recurrence}
          defaultDate={modal.date}
          onClose={() => setModal(null)}
          onSuccess={onSuccess}
        />
      ) : null}
      {modal?.type === "edit" ? (
        <OpeningModal
          editRule={modal.rule}
          onClose={() => setModal(null)}
          onSuccess={onSuccess}
        />
      ) : null}
      {modal?.type === "vacation" ? (
        <VacationModal onClose={() => setModal(null)} onSuccess={onSuccess} />
      ) : null}
    </div>
  );
}

function BlockMenu({
  block,
  pending,
  onClose,
  onEdit,
  onCloseDay,
  onReopen,
  onDelete,
}: {
  block: CalendarBlock;
  pending: boolean;
  onClose: () => void;
  onEdit: () => void;
  onCloseDay: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const itemClass =
    "w-full rounded-lg px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-dark/5 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xs rounded-2xl bg-white p-3 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-dark/45">
          {block.label} · {block.kind === "recurring" ? "régulière" : "ponctuelle"}
        </div>

        {block.kind === "recurring" && !block.excluded ? (
          <button type="button" onClick={onEdit} className={itemClass}>
            Modifier cette ouverture
          </button>
        ) : null}

        {block.excluded ? (
          <button
            type="button"
            onClick={onReopen}
            disabled={pending}
            className={`${itemClass} text-green-900`}
          >
            Rouvrir ce jour
          </button>
        ) : (
          <button
            type="button"
            onClick={onCloseDay}
            disabled={pending || block.hasActiveOrder}
            title={
              block.hasActiveOrder
                ? "Une commande est liée à ce créneau"
                : undefined
            }
            className={itemClass}
          >
            Fermer ce jour
          </button>
        )}

        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className={`${itemClass} text-terra-700`}
        >
          {block.kind === "recurring"
            ? "Supprimer cette ouverture régulière"
            : "Supprimer cette ouverture"}
        </button>

        <button
          type="button"
          onClick={onClose}
          className={`${itemClass} text-dark/60`}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

function VacationModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setInfo(null);
    const fd = new FormData();
    fd.set("start_date", from);
    fd.set("end_date", to);
    startTransition(async () => {
      const res = await bulkExcludeRangeAction({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      if ((res.count_excluded ?? 0) === 0) {
        setInfo("Aucune ouverture à fermer sur cette période.");
        return;
      }
      onSuccess();
    });
  }

  const valid = from !== "" && to !== "" && to >= from;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-green-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vacation-modal-title"
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-8 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="vacation-modal-title"
          className="font-serif text-[24px] leading-tight text-green-900"
        >
          Poser des vacances
        </h2>
        <p className="mt-1 text-[13px] text-dark/60">
          Toutes vos ouvertures sur la période seront fermées. Les clients ne
          pourront plus réserver ces jours-là.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">Du</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-dark/70">Au</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-dark/10 bg-white px-3 text-[15px] outline-none focus:border-green-700"
            />
          </label>
        </div>

        {error ? (
          <p className="mt-3 text-[13px] text-terra-700" role="alert">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="mt-3 text-[13px] text-dark/60">{info}</p>
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
            disabled={!valid || pending}
            className="rounded-md bg-terra-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terra-700/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "…" : "Fermer ces jours"}
          </button>
        </div>
      </div>
    </div>
  );
}

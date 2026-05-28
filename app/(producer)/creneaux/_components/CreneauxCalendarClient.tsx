"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WeekNavigator } from "../../_components/WeekNavigator";
import type { SlotRuleRow } from "@/lib/slots/validators";
import type { CalendarBlock, CalendarDay } from "@/lib/slots/group-week-slots";
import {
  deleteSlotRuleAction,
  deleteAdHocOpeningAction,
} from "../actions";
import OpeningModal from "./OpeningModal";
import UnavailabilitiesCalendarModal from "./UnavailabilitiesCalendarModal";

// Calendrier hebdomadaire des ouvertures (ADR-0012). Une grille 7 jours, des
// blocs colorés par ouverture. Gestes : ajouter (régulier/ponctuel),
// supprimer, et poser/retirer une indisponibilité (jour entier — ADR-0016).
// Langage non technique.

type ActionResult = {
  error?: string;
  success?: boolean;
};

type ModalState =
  | { type: "create"; recurrence: "recurring" | "oneoff"; date?: string }
  | { type: "edit"; rule: SlotRuleRow }
  | { type: "unavailability" }
  | null;

function blockClasses(block: CalendarBlock): string {
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
  unavailableDateKeys,
  dateKeysWithSlots,
  dateKeysWithActiveOrders,
  unavailabilityEntries,
}: {
  weekOffset: number;
  periodLabel: string;
  days: CalendarDay[];
  rules: SlotRuleRow[];
  /** YYYY-MM-DD des jours marqués indispo (semaine affichée + au-delà pour modale). */
  unavailableDateKeys: string[];
  /** YYYY-MM-DD des jours avec créneaux configurés (semaine affichée + au-delà). */
  dateKeysWithSlots: string[];
  /** YYYY-MM-DD des jours avec ≥1 commande active. */
  dateKeysWithActiveOrders: string[];
  /** Map dateKey → unavailability.id pour permettre la suppression depuis la modale. */
  unavailabilityEntries: Array<[string, string]>;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [menu, setMenu] = useState<{ block: CalendarBlock; dateKey: string } | null>(
    null,
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const unavailableDates = useMemo(
    () => new Set(unavailableDateKeys),
    [unavailableDateKeys],
  );
  const datesWithSlots = useMemo(
    () => new Set(dateKeysWithSlots),
    [dateKeysWithSlots],
  );
  const datesWithActiveOrders = useMemo(
    () => new Set(dateKeysWithActiveOrders),
    [dateKeysWithActiveOrders],
  );
  const unavailabilityIdByDate = useMemo(
    () => new Map(unavailabilityEntries),
    [unavailabilityEntries],
  );

  // unavailableDates est calculé global (modale + grille) ; on dérive le
  // sous-set restreint à la semaine pour le marquage visuel des colonnes.
  const weekUnavailableSet = useMemo(() => {
    const s = new Set<string>();
    for (const day of days) if (unavailableDates.has(day.dateKey)) s.add(day.dateKey);
    return s;
  }, [days, unavailableDates]);

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
            onClick={() => setModal({ type: "unavailability" })}
            className="rounded-lg border border-green-700 px-4 py-2 text-[13px] font-semibold text-green-900 transition-colors hover:bg-green-100/50"
          >
            Indisponibilité
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
        {days.map((day) => {
          const isUnavailable = weekUnavailableSet.has(day.dateKey);
          if (isUnavailable) {
            return (
              <UnavailableDayCell
                key={day.dateKey}
                day={day}
                onClickReopen={() => setModal({ type: "unavailability" })}
              />
            );
          }
          return (
            <RegularDayCell
              key={day.dateKey}
              day={day}
              onBlockClick={(block) => setMenu({ block, dateKey: day.dateKey })}
              onAddOneoff={() =>
                setModal({
                  type: "create",
                  recurrence: "oneoff",
                  date: day.dateKey,
                })
              }
            />
          );
        })}
      </div>

      {/* Menu contextuel d'un bloc (suppression d'ouverture uniquement) */}
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
          onDelete={() =>
            run(() =>
              menu.block.kind === "recurring" && menu.block.ruleId
                ? deleteSlotRuleAction(menu.block.ruleId)
                : deleteAdHocOpeningAction(menu.block.slotIds),
            )
          }
        />
      ) : null}

      {/* Modale d'ajout / édition d'ouverture */}
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
      {modal?.type === "unavailability" ? (
        <UnavailabilitiesCalendarModal
          unavailableDates={unavailableDates}
          datesWithSlots={datesWithSlots}
          datesWithActiveOrders={datesWithActiveOrders}
          unavailabilityIdByDate={unavailabilityIdByDate}
          onClose={() => setModal(null)}
          onSuccess={onSuccess}
        />
      ) : null}
    </div>
  );
}

function RegularDayCell({
  day,
  onBlockClick,
  onAddOneoff,
}: {
  day: CalendarDay;
  onBlockClick: (block: CalendarBlock) => void;
  onAddOneoff: () => void;
}) {
  return (
    <div
      className={`flex min-h-[160px] flex-col rounded-xl border p-2 ${
        day.isToday
          ? "border-green-500 bg-green-100/40"
          : "border-dark/[0.08] bg-white"
      }`}
      data-testid="creneaux-day-cell"
      data-date-key={day.dateKey}
    >
      <DayHeader day={day} />

      <div className="flex flex-1 flex-col gap-1.5">
        {day.blocks.map((block) => (
          <button
            key={block.key}
            type="button"
            onClick={() => onBlockClick(block)}
            className={`rounded-lg border px-2 py-1.5 text-left text-[12px] transition-colors ${blockClasses(block)}`}
          >
            <div className="font-semibold leading-tight">{block.label}</div>
            <div className="text-[10px] opacity-80">{modeLabel(block)}</div>
          </button>
        ))}

        <button
          type="button"
          onClick={onAddOneoff}
          className="mt-auto rounded-lg border border-dashed border-dark/15 py-1 text-[16px] leading-none text-dark/30 transition-colors hover:border-green-700/40 hover:text-green-700"
          aria-label={`Ajouter une ouverture le ${day.dateKey}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function UnavailableDayCell({
  day,
  onClickReopen,
}: {
  day: CalendarDay;
  onClickReopen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClickReopen}
      data-testid="creneaux-day-cell-unavailable"
      data-date-key={day.dateKey}
      className="flex min-h-[160px] flex-col items-center justify-start gap-2 rounded-xl border border-dashed border-terra-700/50 bg-terra-700/[0.04] p-2 text-left transition-colors hover:bg-terra-700/[0.08]"
      title="Indisponibilité — cliquer pour retirer"
      aria-label={`${day.dateKey} indisponibilité posée — cliquer pour ouvrir le calendrier des indisponibilités`}
    >
      <DayHeader day={day} tone="muted" />
      <div className="mt-2 flex flex-col items-center gap-1 text-terra-700">
        <Lock />
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          Indisponible
        </span>
      </div>
    </button>
  );
}

function DayHeader({
  day,
  tone = "normal",
}: {
  day: CalendarDay;
  tone?: "normal" | "muted";
}) {
  return (
    <div className="mb-2 text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-dark/50">
        {day.weekdayLabel}
      </div>
      <div
        className={`text-[16px] font-serif ${
          tone === "muted"
            ? "text-terra-700/80"
            : day.isToday
              ? "text-green-700"
              : "text-green-900"
        }`}
      >
        {day.dayNum}
      </div>
    </div>
  );
}

function Lock() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="currentColor"
    >
      <path d="M4.5 7V4.5a3.5 3.5 0 117 0V7H12v6H4V7h.5zm1 0h5V4.5a2.5 2.5 0 00-5 0V7z" />
    </svg>
  );
}

function BlockMenu({
  block,
  pending,
  onClose,
  onEdit,
  onDelete,
}: {
  block: CalendarBlock;
  pending: boolean;
  onClose: () => void;
  onEdit: () => void;
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

        {block.kind === "recurring" ? (
          <button type="button" onClick={onEdit} className={itemClass}>
            Modifier cette ouverture
          </button>
        ) : null}

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

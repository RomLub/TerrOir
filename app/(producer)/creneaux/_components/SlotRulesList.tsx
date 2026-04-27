"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { formatLegacyTimeHHMM } from "@/lib/slots/format-slot-time";
import type { SlotRuleRow } from "@/lib/slots/validators";
import {
  deleteSlotRuleAction,
  toggleSlotRuleActiveAction,
} from "../actions";
import SlotRuleModal from "./SlotRuleModal";

const DAY_LABELS_SHORT: Record<number, string> = {
  1: "Lun",
  2: "Mar",
  3: "Mer",
  4: "Jeu",
  5: "Ven",
  6: "Sam",
  0: "Dim",
};

// Ordre de présentation lundi→dimanche (cohérent avec la modale).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function formatDaysLabel(days: number[]): string {
  const sorted = DAY_ORDER.filter((d) => days.includes(d));
  return sorted.map((d) => DAY_LABELS_SHORT[d]).join(" · ");
}

function formatPeriodicity(weeks: number): string {
  if (weeks === 1) return "Toutes les semaines";
  return `Toutes les ${weeks} semaines`;
}

function timeToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return 0;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

function previewSlotCount(rule: SlotRuleRow): number {
  if (rule.days_of_week.length === 0) return 0;
  const startMin = timeToMinutes(rule.start_time);
  const endMin = timeToMinutes(rule.end_time);
  if (endMin <= startMin) return 0;
  const slotsPerDay = Math.floor(
    (endMin - startMin) / rule.slot_duration_minutes,
  );
  if (slotsPerDay <= 0) return 0;
  const period = Math.max(1, rule.periodicity_weeks);
  const cycles = Math.ceil(4 / period);
  return rule.days_of_week.length * slotsPerDay * cycles;
}

const STATUS_TTL_MS = 3000;

export default function SlotRulesList({ rules }: { rules: SlotRuleRow[] }) {
  const router = useRouter();
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [selectedRule, setSelectedRule] = useState<SlotRuleRow | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const ordered = useMemo(() => {
    const active = rules.filter((r) => r.active);
    const inactive = rules.filter((r) => !r.active);
    return [...active, ...inactive];
  }, [rules]);

  const flash = (msg: string) => {
    setStatusMessage(msg);
    setErrorMessage(null);
    setTimeout(() => setStatusMessage(null), STATUS_TTL_MS);
  };

  const flashError = (msg: string) => {
    setErrorMessage(msg);
    setStatusMessage(null);
    setTimeout(() => setErrorMessage(null), STATUS_TTL_MS);
  };

  const handleToggle = (rule: SlotRuleRow) => {
    startTransition(async () => {
      const res = await toggleSlotRuleActiveAction(rule.id);
      if ("error" in res) {
        flashError(res.error);
        return;
      }
      flash(res.active ? "Règle activée." : "Règle désactivée.");
      router.refresh();
    });
  };

  const handleDelete = (rule: SlotRuleRow) => {
    startTransition(async () => {
      const res = await deleteSlotRuleAction(rule.id);
      setConfirmingDelete(null);
      if ("error" in res) {
        flashError(res.error);
        return;
      }
      flash("Règle supprimée.");
      router.refresh();
    });
  };

  const openCreate = () => {
    setSelectedRule(null);
    setModalMode("create");
  };
  const openEdit = (rule: SlotRuleRow) => {
    setSelectedRule(rule);
    setModalMode("edit");
  };
  const closeModal = () => {
    setModalMode(null);
    setSelectedRule(null);
  };
  const onModalSuccess = () => {
    flash(modalMode === "create" ? "Règle créée." : "Règle mise à jour.");
    closeModal();
    router.refresh();
  };

  return (
    <>
      <div className="mb-6 flex items-center justify-end">
        <Button variant="accent" size="lg" onClick={openCreate}>
          + Ajouter une règle
        </Button>
      </div>

      {ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-dark/10 bg-white/40 p-10 text-center">
          <h3 className="font-serif text-[22px] text-green-900">
            Aucune règle de créneaux
          </h3>
          <p className="mt-2 text-[14px] text-dark/60">
            Créez votre première règle pour ouvrir des créneaux de retrait.
          </p>
          <div className="mt-5">
            <Button variant="accent" size="lg" onClick={openCreate}>
              Créer votre première règle
            </Button>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {ordered.map((rule) => {
            const confirming = confirmingDelete === rule.id;
            const preview = previewSlotCount(rule);
            return (
              <li
                key={rule.id}
                className={`rounded-2xl border bg-white p-5 shadow-soft transition-opacity ${
                  rule.active
                    ? "border-dark/[0.06]"
                    : "border-dark/[0.06] opacity-60"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-[20px] text-green-900">
                        {formatDaysLabel(rule.days_of_week)}
                      </span>
                      <span className="mono text-[13px] text-dark/60">
                        {formatLegacyTimeHHMM(rule.start_time)}–
                        {formatLegacyTimeHHMM(rule.end_time)}
                      </span>
                      {!rule.active ? (
                        <span className="rounded-full bg-dark/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-dark/60">
                          Désactivée
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] text-dark/60">
                      {formatPeriodicity(rule.periodicity_weeks)} ·{" "}
                      {rule.slot_duration_minutes} min par créneau · max{" "}
                      {rule.capacity_per_slot} client
                      {rule.capacity_per_slot > 1 ? "s" : ""}
                    </p>
                    <p className="mt-1 text-[12px] text-dark/45">
                      ~{preview} créneau{preview > 1 ? "x" : ""} sur 4
                      semaines
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {confirming ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(null)}
                          className="text-[13px] text-dark/60 hover:text-dark"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(rule)}
                          className="rounded-md bg-terra-700 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-terra-700/90"
                        >
                          Confirmer
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(rule)}
                          className="text-[13px] text-green-900 hover:underline"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggle(rule)}
                          className="text-[13px] text-dark/70 hover:underline"
                        >
                          {rule.active ? "Désactiver" : "Activer"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(rule.id)}
                          className="text-[13px] text-terra-700 hover:underline"
                        >
                          Supprimer
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {statusMessage ? (
        <p className="mt-4 text-[13px] text-green-900" role="status">
          {statusMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-4 text-[13px] text-terra-700" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {modalMode ? (
        <SlotRuleModal
          mode={modalMode}
          initialRule={selectedRule ?? undefined}
          onClose={closeModal}
          onSuccess={onModalSuccess}
        />
      ) : null}
    </>
  );
}

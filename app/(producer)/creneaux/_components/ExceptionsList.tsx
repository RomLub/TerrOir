"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  formatSlotDateTime,
  formatSlotRange,
} from "@/lib/slots/format-slot-time";
import { unexcludeSlotAction } from "../actions";
import ExcludeSlotModal, {
  type FutureActiveSlot,
} from "./ExcludeSlotModal";
import BulkExcludeRangeModal from "./BulkExcludeRangeModal";

export interface ExcludedSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  rule_id: string | null;
}

const STATUS_TTL_MS = 3000;

export default function ExceptionsList({
  exceptions,
  futureActiveSlots,
  blockedSlotIds,
}: {
  exceptions: ExcludedSlot[];
  futureActiveSlots: FutureActiveSlot[];
  blockedSlotIds: string[];
}) {
  const router = useRouter();
  const [excludeModalOpen, setExcludeModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [confirmingUnexclude, setConfirmingUnexclude] = useState<string | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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

  const handleUnexclude = (slot: ExcludedSlot) => {
    startTransition(async () => {
      const res = await unexcludeSlotAction(slot.id);
      setConfirmingUnexclude(null);
      if ("error" in res) {
        flashError(res.error);
        return;
      }
      flash("Créneau rétabli.");
      router.refresh();
    });
  };

  const onExcludeSuccess = (slotLabel: string) => {
    setExcludeModalOpen(false);
    flash(`Créneau exclu : ${slotLabel}`);
    router.refresh();
  };

  const onBulkSuccess = (summary: string) => {
    setBulkModalOpen(false);
    flash(summary);
    router.refresh();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="lg"
          onClick={() => setExcludeModalOpen(true)}
        >
          + Annuler un créneau
        </Button>
        <Button variant="accent" size="lg" onClick={() => setBulkModalOpen(true)}>
          + Annuler une plage
        </Button>
      </div>

      {exceptions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-dark/10 bg-white/40 p-8 text-center">
          <p className="text-[14px] text-dark/60">
            Aucune exception active.
          </p>
          <p className="mt-1 text-[12px] text-dark/45">
            Excluez un créneau ponctuellement ou une plage pour vos absences.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {exceptions.map((slot) => {
            const confirming = confirmingUnexclude === slot.id;
            return (
              <li
                key={slot.id}
                className="rounded-2xl border border-dark/[0.06] bg-white p-5 shadow-soft opacity-75"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-[18px] text-green-900">
                      {formatSlotDateTime(slot.starts_at)}
                    </div>
                    <p className="mt-1 text-[13px] text-dark/60">
                      {formatSlotRange(slot.starts_at, slot.ends_at)} ·{" "}
                      {slot.rule_id ? "Règle récurrente" : "Ponctuel"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {confirming ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmingUnexclude(null)}
                          className="text-[13px] text-dark/60 hover:text-dark"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnexclude(slot)}
                          className="rounded-md bg-green-700 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-green-700/90"
                        >
                          Confirmer
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingUnexclude(slot.id)}
                        className="text-[13px] text-green-700 hover:underline"
                      >
                        Rétablir
                      </button>
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

      {excludeModalOpen ? (
        <ExcludeSlotModal
          activeSlots={futureActiveSlots}
          blockedSlotIds={blockedSlotIds}
          onClose={() => setExcludeModalOpen(false)}
          onSuccess={onExcludeSuccess}
        />
      ) : null}

      {bulkModalOpen ? (
        <BulkExcludeRangeModal
          onClose={() => setBulkModalOpen(false)}
          onSuccess={onBulkSuccess}
        />
      ) : null}
    </>
  );
}

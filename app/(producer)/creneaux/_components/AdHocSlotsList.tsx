"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { formatSlotDateTime, formatSlotTime } from "@/lib/slots/format-slot-time";
import { deleteAdHocSlotAction } from "../actions";
import AdHocSlotModal from "./AdHocSlotModalLazy";

export interface AdHocSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity_per_slot: number;
}

const STATUS_TTL_MS = 3000;

export default function AdHocSlotsList({ slots }: { slots: AdHocSlot[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(
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

  const handleDelete = (slot: AdHocSlot) => {
    startTransition(async () => {
      const res = await deleteAdHocSlotAction(slot.id);
      setConfirmingDelete(null);
      if ("error" in res) {
        flashError(res.error);
        return;
      }
      flash("Créneau ponctuel supprimé.");
      router.refresh();
    });
  };

  const onAddSuccess = () => {
    setModalOpen(false);
    flash("Créneau ponctuel créé.");
    router.refresh();
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Button variant="primary" size="lg" onClick={() => setModalOpen(true)}>
          + Ajouter un créneau ponctuel
        </Button>
      </div>

      {slots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-dark/10 bg-white/40 p-8 text-center">
          <p className="text-[14px] text-dark/60">
            Aucun créneau ponctuel pour le moment.
          </p>
          <p className="mt-1 text-[12px] text-dark/45">
            Idéal pour une ouverture exceptionnelle hors de vos règles
            récurrentes.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {slots.map((slot) => {
            const confirming = confirmingDelete === slot.id;
            return (
              <li
                key={slot.id}
                className="rounded-2xl border border-dark/[0.06] bg-white p-5 shadow-soft"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-[18px] text-green-900">
                      {formatSlotDateTime(slot.starts_at)}
                    </div>
                    <p className="mt-1 text-[13px] text-dark/60">
                      Jusqu&apos;à {formatSlotTime(slot.ends_at)} · max{" "}
                      {slot.capacity_per_slot} client
                      {slot.capacity_per_slot > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
                          onClick={() => handleDelete(slot)}
                          className="rounded-md bg-terra-700 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-terra-700/90"
                        >
                          Confirmer
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(slot.id)}
                        className="text-[13px] text-terra-700 hover:underline"
                      >
                        Supprimer
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

      {modalOpen ? (
        <AdHocSlotModal
          onClose={() => setModalOpen(false)}
          onSuccess={onAddSuccess}
        />
      ) : null}
    </>
  );
}

'use client';

import { Button, Input } from '@/components/ui';
import { formatSlotDateTime, formatSlotRange } from '@/lib/slots/format-slot-time';

export type ProductPickupAvailabilityMode =
  | 'all_shared_slots'
  | 'selected_slots';

export type ProductPickupSlotOption = {
  id: string;
  startsAt: string;
  endsAt: string;
  availabilityScope: 'shared' | 'product_restricted';
  linkedProductIds: string[];
};

export type ReservedProductSlotDraft = {
  id: string;
  startAt: string;
  endAt: string;
  capacity: string;
};

type ProductPickupSectionProps = {
  productId?: string;
  mode: ProductPickupAvailabilityMode;
  slots: ProductPickupSlotOption[];
  selectedSlotIds: string[];
  reservedSlots: ReservedProductSlotDraft[];
  error?: string | null;
  onModeChange: (mode: ProductPickupAvailabilityMode) => void;
  onToggleSlot: (slotId: string) => void;
  onAddReservedSlot: () => void;
  onUpdateReservedSlot: (
    id: string,
    field: keyof Omit<ReservedProductSlotDraft, 'id'>,
    value: string,
  ) => void;
  onRemoveReservedSlot: (id: string) => void;
};

function isSlotDisabled(
  slot: ProductPickupSlotOption,
  productId: string | undefined,
): boolean {
  if (slot.availabilityScope !== 'product_restricted') return false;
  if (slot.linkedProductIds.length === 0) return false;
  return productId
    ? !slot.linkedProductIds.includes(productId)
    : slot.linkedProductIds.length > 0;
}

export function ProductPickupSection({
  productId,
  mode,
  slots,
  selectedSlotIds,
  reservedSlots,
  error,
  onModeChange,
  onToggleSlot,
  onAddReservedSlot,
  onUpdateReservedSlot,
  onRemoveReservedSlot,
}: ProductPickupSectionProps) {
  const selected = new Set(selectedSlotIds);

  return (
    <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-serif text-[22px] text-green-900">
            Retrait du produit
          </h2>
          <p className="mt-1 text-[13px] text-dark/55">
            Choisissez quand ce produit peut être retiré par les clients.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <label className="flex gap-3 rounded-xl border border-dark/[0.08] bg-bg/40 p-4 cursor-pointer">
          <input
            type="radio"
            name="pickup_availability_mode"
            value="all_shared_slots"
            checked={mode === 'all_shared_slots'}
            onChange={() => onModeChange('all_shared_slots')}
            className="mt-1 h-4 w-4 accent-green-700"
          />
          <span>
            <span className="block text-[14px] font-semibold text-green-900">
              Disponible sur tous mes créneaux de retrait
            </span>
            <span className="mt-0.5 block text-[12px] text-dark/55">
              C&apos;est le réglage habituel pour un produit.
            </span>
          </span>
        </label>

        <label className="flex gap-3 rounded-xl border border-dark/[0.08] bg-bg/40 p-4 cursor-pointer">
          <input
            type="radio"
            name="pickup_availability_mode"
            value="selected_slots"
            checked={mode === 'selected_slots'}
            onChange={() => onModeChange('selected_slots')}
            className="mt-1 h-4 w-4 accent-green-700"
          />
          <span>
            <span className="block text-[14px] font-semibold text-green-900">
              Disponible seulement sur certains créneaux
            </span>
            <span className="mt-0.5 block text-[12px] text-dark/55">
              Utile pour un colis, une découpe ou une préparation disponible à
              date précise.
            </span>
          </span>
        </label>
      </div>

      {mode === 'selected_slots' && (
        <div className="mt-5 rounded-xl border border-dark/[0.06] bg-bg/60 p-4">
          <div className="text-[13px] font-semibold text-green-900">
            Créneaux existants
          </div>

          {slots.length === 0 ? (
            <p className="mt-2 text-[13px] text-dark/60">
              Aucun créneau de retrait n&apos;existe encore.
            </p>
          ) : (
            <div className="mt-3 grid gap-2">
              {slots.map((slot) => {
                const disabled = isSlotDisabled(slot, productId);
                return (
                  <label
                    key={slot.id}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                      disabled
                        ? 'border-dark/[0.04] bg-white/50 text-dark/40'
                        : 'border-dark/[0.06] bg-white text-dark/80 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(slot.id)}
                      disabled={disabled}
                      onChange={() => onToggleSlot(slot.id)}
                      className="mt-1 h-4 w-4 accent-green-700 disabled:opacity-40"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">
                        {formatSlotDateTime(slot.startsAt)}
                      </span>
                      <span className="block text-[12px] text-dark/55">
                        {formatSlotRange(slot.startsAt, slot.endsAt)}
                        {slot.availabilityScope === 'product_restricted'
                          ? ' · réservé'
                          : ''}
                      </span>
                      {disabled && (
                        <span className="mt-0.5 block text-[12px] text-terra-700">
                          Ce créneau est réservé à un autre produit.
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 rounded-xl border border-green-700/15 bg-green-50/60 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[13px] font-semibold text-green-900">
              Créer un créneau réservé à ce produit
            </div>
            <p className="mt-0.5 text-[12px] text-dark/55">
              Ce créneau sera proposé uniquement pour ce produit.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAddReservedSlot}
          >
            Créer un créneau réservé à ce produit
          </Button>
        </div>

        {reservedSlots.length > 0 && (
          <div className="mt-4 space-y-3">
            {reservedSlots.map((slot, index) => (
              <div
                key={slot.id}
                className="rounded-lg border border-dark/[0.06] bg-white p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-[13px] font-semibold text-green-900">
                    Créneau réservé {index + 1}
                  </div>
                  <button
                    type="button"
                    className="text-[12px] font-medium text-terra-700 hover:text-terra-800"
                    onClick={() => onRemoveReservedSlot(slot.id)}
                  >
                    Retirer
                  </button>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Input
                    id={`reserved-${slot.id}-start`}
                    label="Début"
                    type="datetime-local"
                    value={slot.startAt}
                    onChange={(e) =>
                      onUpdateReservedSlot(slot.id, 'startAt', e.target.value)
                    }
                    required
                  />
                  <Input
                    id={`reserved-${slot.id}-end`}
                    label="Fin"
                    type="datetime-local"
                    value={slot.endAt}
                    onChange={(e) =>
                      onUpdateReservedSlot(slot.id, 'endAt', e.target.value)
                    }
                    required
                  />
                  <Input
                    id={`reserved-${slot.id}-capacity`}
                    label="Places"
                    type="number"
                    min={1}
                    step={1}
                    value={slot.capacity}
                    onChange={(e) =>
                      onUpdateReservedSlot(slot.id, 'capacity', e.target.value)
                    }
                    required
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-[13px] text-terra-700">{error}</p>}
    </section>
  );
}

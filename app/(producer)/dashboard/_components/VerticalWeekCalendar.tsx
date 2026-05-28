'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TZDate } from '@date-fns/tz';
import { groupIntoBands, type Band } from '@/lib/slots/group-into-bands';

// Calendrier vertical du dashboard producteur. Remplace WeekPlanningHeatmap
// (bandeau horizontal). Affiche les "plages paramétrées" du producteur :
// chaque rule un jour = une bande, ponctuels contigus = une bande, jamais
// une bande par slot RDV.
//
// Le cas nominal du producteur circuit court est d'être ouvert 1-2
// jours/semaine. La grille reste élégante quand 5-6 colonnes sont vides :
// l'axe horaire reste visible en arrière-plan léger (graduations subtiles)
// et le header de jour garde son label — pas de "fermé" textuel.
//
// Doctrine projet : pas de Radix, pas de lib popover externe (cf.
// HelpTooltip lignes 11-16). Popover maison disclosure click-to-toggle,
// dismiss Escape + click-outside. Cohérent desktop + mobile (tap).

const TZ = 'Europe/Paris';

// Amplitude horaire fixe pour le calendrier dashboard (2026-05-28). La grille
// affiche toujours 6h-21h, indépendamment des créneaux paramétrés. Décision
// produit : l'amplitude doit donner un repère stable plutôt que de zoomer sur
// les seuls créneaux ouverts (un jour 9h-12h ne doit pas dicter la lecture
// des 6 autres colonnes). Plage volontairement large pour absorber les
// horaires extrêmes (marchés matinaux, AMAP en soirée).
const FIXED_HOUR_RANGE = { startHour: 6, endHour: 21 } as const;

export type VerticalSlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity_per_slot: number;
  rule_id: string | null;
  orders_count: number;
  orders: { order_id: string; code_commande: string; starts_at: string }[];
};

export type VerticalDay = {
  dateIso: string;
  dayLabel: string;
  isToday: boolean;
  slots: VerticalSlot[];
};

type HourRange = { startHour: number; endHour: number };

type Props = {
  days: VerticalDay[];
};

// Heure décimale Paris depuis un ISO timestamptz (ex: 9.5 = 9h30).
function hourFracParis(iso: string): number {
  const d = new TZDate(iso, TZ);
  return d.getHours() + d.getMinutes() / 60;
}

// "9h" / "9h30" — pour les labels de bande et de tooltip.
function formatTimeParis(iso: string): string {
  const d = new TZDate(iso, TZ);
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function formatBandRange(startIso: string, endIso: string): string {
  return `${formatTimeParis(startIso)}–${formatTimeParis(endIso)}`;
}

function tickStep(range: HourRange): 1 | 2 {
  return range.endHour - range.startHour > 12 ? 2 : 1;
}

function HourAxis({ range }: { range: HourRange }) {
  const span = range.endHour - range.startHour;
  const step = tickStep(range);
  const ticks: number[] = [];
  for (let h = range.startHour; h <= range.endHour; h += step) {
    ticks.push(h);
  }
  return (
    <div className="relative h-full" aria-hidden="true">
      {ticks.map((h) => {
        const topPct = ((h - range.startHour) / span) * 100;
        return (
          <div
            key={h}
            className="absolute right-2 -translate-y-1/2 text-[10px] text-dark/45 tabular-nums"
            style={{ top: `${topPct}%` }}
          >
            {h}h
          </div>
        );
      })}
    </div>
  );
}

// Graduations horizontales en arrière-plan d'une colonne jour. Subtiles —
// elles donnent la lecture d'échelle même quand la colonne est vide.
function ColumnGrid({ range }: { range: HourRange }) {
  const span = range.endHour - range.startHour;
  const step = tickStep(range);
  const ticks: number[] = [];
  for (let h = range.startHour; h <= range.endHour; h += step) {
    ticks.push(h);
  }
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {ticks.map((h) => {
        const topPct = ((h - range.startHour) / span) * 100;
        return (
          <div
            key={h}
            className="absolute left-0 right-0 h-px bg-dark/[0.06]"
            style={{ top: `${topPct}%` }}
          />
        );
      })}
    </div>
  );
}

function BandBlock({
  band,
  range,
}: {
  band: Band;
  range: HourRange;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && wrapperRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const span = range.endHour - range.startHour;
  const startFrac = Math.max(range.startHour, hourFracParis(band.startsAt));
  const endFrac = Math.min(range.endHour, hourFracParis(band.endsAt));
  if (endFrac <= startFrac) return null;

  const topPct = ((startFrac - range.startHour) / span) * 100;
  const heightPct = ((endFrac - startFrac) / span) * 100;

  const hasOrders = band.totalOrders > 0;
  const popoverId = `band-popover-${band.key}`;

  const bandClasses = hasOrders
    ? 'bg-terra-100 border border-terra-300/70 text-terra-900 hover:border-terra-500 focus-visible:ring-2 focus-visible:ring-terra-700'
    : 'bg-green-100/70 border border-green-300/50 text-green-900';

  const content = (
    <>
      <div className="flex items-start justify-between gap-1 px-1.5 pt-1">
        <div className="font-serif text-[12px] leading-tight truncate">
          {formatBandRange(band.startsAt, band.endsAt)}
        </div>
        {hasOrders && (
          <span
            className="shrink-0 rounded-full bg-terra-700 text-white text-[10px] font-semibold px-1.5 py-0.5 tabular-nums"
            aria-label={`${band.totalOrders} commande${band.totalOrders > 1 ? 's' : ''}`}
          >
            {band.totalOrders}
          </span>
        )}
      </div>
    </>
  );

  return (
    <div
      ref={wrapperRef}
      className="absolute left-0.5 right-0.5"
      style={{ top: `${topPct}%`, height: `${heightPct}%` }}
    >
      {hasOrders ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={`Plage ${formatBandRange(band.startsAt, band.endsAt)} — ${band.totalOrders} commande${band.totalOrders > 1 ? 's' : ''}`}
          className={`w-full h-full rounded-md text-left transition-colors outline-none ${bandClasses}`}
          data-testid="planning-band"
          data-source={band.source}
          data-orders-count={band.totalOrders}
        >
          {content}
        </button>
      ) : (
        <div
          className={`w-full h-full rounded-md ${bandClasses}`}
          data-testid="planning-band"
          data-source={band.source}
          data-orders-count={0}
        >
          {content}
        </div>
      )}
      {open && hasOrders && (
        <div
          id={popoverId}
          role="dialog"
          aria-modal="false"
          aria-label={`Commandes ${formatBandRange(band.startsAt, band.endsAt)}`}
          data-testid="planning-band-popover"
          className="
            fixed inset-x-4 bottom-4 z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-dark/[0.08]
            bg-white p-4 shadow-2xl
            md:absolute md:inset-auto md:bottom-auto md:left-full md:top-0 md:ml-2 md:w-64
            md:max-h-none md:rounded-md md:shadow-lg md:p-3
          "
        >
          <div className="text-[11px] uppercase tracking-[0.12em] text-terra-700 font-semibold">
            {formatBandRange(band.startsAt, band.endsAt)}
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-dark">
            {band.totalOrders} commande{band.totalOrders > 1 ? 's' : ''}
          </div>
          <ul className="mt-2 space-y-1">
            {band.orders.map((o) => (
              <li key={o.order_id}>
                <Link
                  href={`/commandes/${o.order_id}`}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[12px] text-dark hover:bg-green-100/50"
                  data-testid="planning-band-order-link"
                  data-order-id={o.order_id}
                >
                  <span className="tabular-nums text-dark/60 shrink-0">
                    {formatTimeParis(o.starts_at)}
                  </span>
                  <span className="font-mono text-[11px] text-terra-900 truncate">
                    {o.code_commande}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DayColumn({
  day,
  range,
}: {
  day: VerticalDay;
  range: HourRange;
}) {
  const bands = groupIntoBands(day.slots);
  return (
    <div
      className={`relative h-full ${day.isToday ? 'bg-green-50/60' : ''}`}
      data-testid="planning-day-column"
      data-date-iso={day.dateIso}
      data-is-today={day.isToday ? '1' : '0'}
    >
      <ColumnGrid range={range} />
      {bands.map((b) => (
        <BandBlock key={b.key} band={b} range={range} />
      ))}
    </div>
  );
}

export function VerticalWeekCalendar({ days }: Props) {
  const hourRange = FIXED_HOUR_RANGE;
  return (
    <div data-testid="vertical-week-calendar">
      {/* Header : axe + 7 labels jours */}
      <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] gap-1 mb-2">
        <div aria-hidden="true" />
        {days.map((d) => (
          <div
            key={d.dateIso}
            className={`text-center text-[11px] uppercase tracking-wider px-1 ${
              d.isToday
                ? 'text-green-900 font-semibold'
                : 'text-dark/55 font-medium'
            }`}
          >
            {d.dayLabel}
          </div>
        ))}
      </div>
      {/* Corps : axe horaire vertical + 7 colonnes jours */}
      <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] gap-1 h-[420px] md:h-[480px]">
        <HourAxis range={hourRange} />
        {days.map((d) => (
          <DayColumn key={d.dateIso} day={d} range={hourRange} />
        ))}
      </div>
    </div>
  );
}

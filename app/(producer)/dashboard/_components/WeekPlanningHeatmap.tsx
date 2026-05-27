'use client';

import Link from 'next/link';

// Bandeau heatmap horaire pour le dashboard producteur. Remplace la grille
// `grid-cols-7` de mini-rectangles empilés (rendu cassé quand un producteur
// configure 30+ créneaux courts) par 7 bandeaux horizontaux alignés sur une
// échelle horaire commune (cf. PHASE 1 chantier 2026-05-28).
//
// Contrat des couleurs : 2 niveaux portés par la couleur du segment.
//   - Libre (orders_count === 0) : bg-green-700
//   - Réservé (orders_count >= 1) : bg-terra-700, ring discret si plein
// Le sous-titre "X dispo · Y réservés" porte la granularité fine,
// pas la couleur.

export type WeekPlanningSlot = {
  id: string;
  /** Heure de début décimale Europe/Paris (ex: 9.5 = 9h30). */
  startHourFrac: number;
  /** Heure de fin décimale Europe/Paris. */
  endHourFrac: number;
  capacity: number;
  ordersCount: number;
};

export type WeekPlanningDay = {
  /** Date locale Paris au format YYYY-MM-DD (clé stable pour drill-down). */
  dateIso: string;
  /** Label déjà formaté (ex: "Lun 25"). */
  dayLabel: string;
  isToday: boolean;
  /**
   * Producteur ouvert ce jour-là (au moins une slot_rule active dont
   * days_of_week contient ce dow, OU au moins un slot ponctuel ce jour).
   * Indépendant de la présence de slots concrets dans la fenêtre.
   */
  isOpen: boolean;
  slots: WeekPlanningSlot[];
};

type WeekHourRange = { startHour: number; endHour: number };

type Props = {
  /** 7 jours dans l'ordre Lun→Dim. */
  days: WeekPlanningDay[];
  hourRange: WeekHourRange;
};

// Heure → libellé "9h" / "13h". Pas de "h00" pour rester compact.
function formatHourLabel(h: number): string {
  return `${h}h`;
}

// "9h30 – 12h00" depuis deux heures décimales. Utilisé en tooltip natif.
function formatHourFracRange(startFrac: number, endFrac: number): string {
  const fmt = (frac: number) => {
    const h = Math.floor(frac);
    const m = Math.round((frac - h) * 60);
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
  };
  return `${fmt(startFrac)} – ${fmt(endFrac)}`;
}

/**
 * Choisit le pas des graduations selon l'amplitude. Tient sur une lecture
 * mobile : ≤12h → tick 1h, sinon 2h. Au-delà de 14h on reste sur 2h —
 * tester sur 3h en preview donnerait trop d'espace mort entre les ticks.
 */
function tickStep(range: WeekHourRange): 1 | 2 {
  return range.endHour - range.startHour > 12 ? 2 : 1;
}

function ticksFor(range: WeekHourRange): number[] {
  const step = tickStep(range);
  const ticks: number[] = [];
  for (let h = range.startHour; h <= range.endHour; h += step) {
    ticks.push(h);
  }
  return ticks;
}

// Calcule le sous-titre métrique du jour. Convention validée :
//   X = somme(capacity - orders_count) — places encore disponibles
//   Y = somme(orders_count) — réservations actives
//   X + Y = capacité totale du jour
function daySubtitle(day: WeekPlanningDay): string {
  if (!day.isOpen) return 'Fermé';
  if (day.slots.length === 0) return 'Aucun créneau';
  let dispo = 0;
  let reserved = 0;
  for (const s of day.slots) {
    const remaining = Math.max(0, s.capacity - s.ordersCount);
    dispo += remaining;
    reserved += s.ordersCount;
  }
  return `${dispo} dispo · ${reserved} réservés`;
}

function DaySegment({ slot, range }: { slot: WeekPlanningSlot; range: WeekHourRange }) {
  const span = range.endHour - range.startHour;
  // Garde-fou : si un slot déborde la fenêtre (rare, en théorie impossible
  // si computeWeekHourRange a vu ce slot), on clamp visuellement.
  const startFrac = Math.max(range.startHour, slot.startHourFrac);
  const endFrac = Math.min(range.endHour, slot.endHourFrac);
  if (endFrac <= startFrac) return null;

  const leftPct = ((startFrac - range.startHour) / span) * 100;
  const widthPct = ((endFrac - startFrac) / span) * 100;

  const isReserved = slot.ordersCount > 0;
  const isFull = slot.ordersCount >= slot.capacity;

  // Couleur : 2 niveaux (libre vert / réservé terra), ring discret quand plein.
  const colorCls = isReserved ? 'bg-terra-700' : 'bg-green-700';
  const ringCls = isFull ? 'ring-1 ring-terra-900' : '';

  return (
    <div
      className={`absolute top-1 bottom-1 rounded ${colorCls} ${ringCls}`}
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      title={`${formatHourFracRange(slot.startHourFrac, slot.endHourFrac)} · ${slot.ordersCount}/${slot.capacity} réservés`}
      data-testid="planning-segment"
      data-orders-count={slot.ordersCount}
      data-capacity={slot.capacity}
    />
  );
}

function DayRow({ day, range }: { day: WeekPlanningDay; range: WeekHourRange }) {
  const subtitle = daySubtitle(day);
  // Track de base : vert clair (ouvert) ou gris hachuré (fermé).
  const trackCls = day.isOpen
    ? 'bg-green-100'
    : 'bg-dark/[0.04] bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.04)_4px,rgba(0,0,0,0.04)_8px)]';

  const labelCls = day.isToday
    ? 'text-green-900 font-semibold'
    : 'text-dark/70 font-medium';

  return (
    <Link
      href={`/creneaux?day=${day.dateIso}`}
      className={`flex items-center gap-4 py-2 px-2 -mx-2 rounded-lg hover:bg-dark/[0.02] transition-colors ${
        day.isToday ? 'bg-green-100/40' : ''
      }`}
      data-testid="planning-day-row"
      data-date-iso={day.dateIso}
      data-is-open={day.isOpen ? '1' : '0'}
    >
      <div className="w-20 shrink-0">
        <div className={`text-[13px] uppercase tracking-wider ${labelCls}`}>
          {day.dayLabel}
        </div>
        <div className="text-[11px] text-dark/55 mt-0.5">{subtitle}</div>
      </div>
      <div className={`relative flex-1 h-8 rounded ${trackCls}`}>
        {day.isOpen &&
          day.slots.map((s) => <DaySegment key={s.id} slot={s} range={range} />)}
      </div>
    </Link>
  );
}

function HourAxis({ range }: { range: WeekHourRange }) {
  const span = range.endHour - range.startHour;
  const ticks = ticksFor(range);
  return (
    <div className="flex items-start gap-4 mt-2">
      <div className="w-20 shrink-0" aria-hidden="true" />
      <div className="relative flex-1 h-5">
        {ticks.map((h) => {
          const leftPct = ((h - range.startHour) / span) * 100;
          return (
            <div
              key={h}
              className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${leftPct}%` }}
            >
              <div className="w-px h-1.5 bg-dark/20" />
              <div className="text-[10px] text-dark/50 mt-0.5 tabular-nums">
                {formatHourLabel(h)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WeekPlanningHeatmap({ days, hourRange }: Props) {
  return (
    <div data-testid="week-planning-heatmap">
      <div className="space-y-1">
        {days.map((d) => (
          <DayRow key={d.dateIso} day={d} range={hourRange} />
        ))}
      </div>
      <HourAxis range={hourRange} />
    </div>
  );
}

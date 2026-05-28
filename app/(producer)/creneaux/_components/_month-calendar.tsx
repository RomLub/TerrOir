"use client";

// Composant pur : grille mensuelle 7 colonnes, navigation mois ◄ ►,
// rendu d'un état par cellule via une prop callback. Sans logique métier
// d'indispo — la modale parente injecte les états (passé, créneaux,
// sélectionné, indispo posée, commandes actives). Helpers purs date-fns,
// pas de dépendance externe.

import { useMemo } from "react";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTH_LABELS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export type MonthCalendarCell = {
  /** YYYY-MM-DD Europe/Paris du jour rendu. */
  dateKey: string;
  /** Numéro de jour 1-31. */
  dayNum: number;
  /** True si ce jour appartient au mois affiché (sinon = padding avant/après). */
  inMonth: boolean;
};

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD en Europe/Paris pour aujourd'hui (côté client). */
export function todayParisKey(now = new Date()): string {
  // Pas besoin de TZDate côté client : `Intl.DateTimeFormat` Europe/Paris
  // est largement portable et évite d'embarquer @date-fns/tz dans le client
  // bundle pour rien.
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Construit la grille 42 cellules (6 lignes × 7 colonnes) du mois donné. */
export function buildMonthGrid(year: number, month0: number): MonthCalendarCell[] {
  // first = 1er du mois, getDay() 0=Dim..6=Sam. Lundi = 1, normaliser à 0.
  const first = new Date(year, month0, 1);
  const firstDow = (first.getDay() + 6) % 7;

  // Dernier jour du mois en cours
  const lastDay = new Date(year, month0 + 1, 0).getDate();

  // Padding avant : on prend la fin du mois précédent
  const prevMonthLastDay = new Date(year, month0, 0).getDate();

  const cells: MonthCalendarCell[] = [];
  for (let i = 0; i < firstDow; i++) {
    const dayNum = prevMonthLastDay - firstDow + 1 + i;
    const prevMonth0 = month0 === 0 ? 11 : month0 - 1;
    const prevYear = month0 === 0 ? year - 1 : year;
    cells.push({
      dateKey: `${prevYear}-${pad2(prevMonth0 + 1)}-${pad2(dayNum)}`,
      dayNum,
      inMonth: false,
    });
  }

  for (let d = 1; d <= lastDay; d++) {
    cells.push({
      dateKey: `${year}-${pad2(month0 + 1)}-${pad2(d)}`,
      dayNum: d,
      inMonth: true,
    });
  }

  // Padding après : début du mois suivant pour compléter 42 cellules
  // (toujours 6 lignes — UI stable au changement de mois).
  let d = 1;
  while (cells.length < 42) {
    const nextMonth0 = month0 === 11 ? 0 : month0 + 1;
    const nextYear = month0 === 11 ? year + 1 : year;
    cells.push({
      dateKey: `${nextYear}-${pad2(nextMonth0 + 1)}-${pad2(d)}`,
      dayNum: d,
      inMonth: false,
    });
    d++;
  }
  return cells;
}

export type MonthCalendarProps = {
  /** Année affichée. */
  year: number;
  /** Mois 0-indexé (0 = janvier). */
  month0: number;
  /** Callback navigation. */
  onChangeMonth: (year: number, month0: number) => void;
  /** Rendu d'une cellule. La modale parente injecte la classe + l'aria + le contenu interne selon l'état du jour. */
  renderCell: (cell: MonthCalendarCell) => React.ReactNode;
};

export function MonthCalendar({
  year,
  month0,
  onChangeMonth,
  renderCell,
}: MonthCalendarProps) {
  const cells = useMemo(() => buildMonthGrid(year, month0), [year, month0]);
  const monthLabel = `${MONTH_LABELS[month0]} ${year}`;

  function prev() {
    if (month0 === 0) onChangeMonth(year - 1, 11);
    else onChangeMonth(year, month0 - 1);
  }
  function next() {
    if (month0 === 11) onChangeMonth(year + 1, 0);
    else onChangeMonth(year, month0 + 1);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={prev}
          aria-label="Mois précédent"
          className="rounded-md px-3 py-1.5 text-[14px] text-dark/70 transition-colors hover:bg-dark/5"
        >
          ◄
        </button>
        <div className="font-serif text-[16px] text-green-900" aria-live="polite">
          {monthLabel}
        </div>
        <button
          type="button"
          onClick={next}
          aria-label="Mois suivant"
          className="rounded-md px-3 py-1.5 text-[14px] text-dark/70 transition-colors hover:bg-dark/5"
        >
          ►
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-dark/50">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => (
          <div key={cell.dateKey}>{renderCell(cell)}</div>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { formatSlotTime } from "@/lib/slots/format-slot-time";
import type {
  MonitoringBlock,
  MonitoringCell,
  MonitoringDay,
} from "@/lib/slots/group-creneaux-monitoring";

// Section "Remplissage des places" affichée sous la grille d'ajout
// (ADR-0014). Vue de monitoring du remplissage par jour :
// chaque jour actif → ses blocs ; chaque bloc → ses cases.
// Une case pleine = une place réservée pointant vers SA commande.
// Une case vide = une place libre. Server component (zéro JS client).

export function MonitoringSection({
  days,
  unavailableDates,
}: {
  days: MonitoringDay[];
  /** Jours marqués indisponibles (ADR-0016). Affichés en ligne dédiée
   *  même sans slots actifs, pour transparence sur l'agenda fermé. */
  unavailableDates: Set<string>;
}) {
  // Liste de jours à afficher : monitoring habituel (jours avec slots actifs)
  // + jours indispos qui ne sont pas déjà dans monitoring. On préserve l'ordre
  // chronologique en mergeant par dateKey.
  type Row =
    | { kind: "monitoring"; day: MonitoringDay; dateKey: string }
    | { kind: "unavailable"; dateKey: string };

  const seenDates = new Set(days.map((d) => d.dateKey));
  const rows: Row[] = days.map((d) => ({
    kind: "monitoring",
    day: d,
    dateKey: d.dateKey,
  }));
  for (const date of unavailableDates) {
    if (!seenDates.has(date)) {
      rows.push({ kind: "unavailable", dateKey: date });
    }
  }
  rows.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby="creneaux-monitoring-title"
      data-testid="monitoring-section"
      className="mt-12 border-t border-terroir-border pt-10"
    >
      <header className="mb-6">
        <h2
          id="creneaux-monitoring-title"
          className="font-serif text-2xl text-dark"
        >
          Remplissage des places
        </h2>
        <p className="mt-1 text-sm text-dark/60">
          Une case pleine = une place réservée. Cliquez sur une case pour ouvrir
          la commande.
        </p>
      </header>

      <div className="flex flex-col gap-8">
        {rows.map((row) =>
          row.kind === "monitoring" ? (
            <MonitoringDayCard key={row.dateKey} day={row.day} />
          ) : (
            <UnavailableDayCard key={row.dateKey} dateKey={row.dateKey} />
          ),
        )}
      </div>
    </section>
  );
}

function UnavailableDayCard({ dateKey }: { dateKey: string }) {
  // Affichage minimal : "Lundi 14" + label "Indisponibilité". Le détail
  // (raison, qui a posé) est owner-only et reste dans la modale calendaire.
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const headline = capitalize(fmt.format(dt));

  return (
    <article
      data-testid="monitoring-day-unavailable"
      data-date-key={dateKey}
      className="rounded-2xl border border-dashed border-terra-700/40 bg-terra-700/[0.04] p-5"
    >
      <header className="flex items-baseline gap-x-3">
        <h3 className="font-serif text-lg text-dark">{headline}</h3>
        <span className="text-sm text-dark/60">·</span>
        <span className="text-sm font-medium uppercase tracking-wide text-terra-700">
          Indisponibilité
        </span>
      </header>
    </article>
  );
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function MonitoringDayCard({ day }: { day: MonitoringDay }) {
  const headline = `${day.weekdayLabel} ${day.dayNum}`;
  const blocksLabel = `${day.blockCount} ${day.blockCount > 1 ? "créneaux" : "créneau"}`;
  const fillLabel = `${day.reservedCount}/${day.totalCapacity} ${day.reservedCount > 1 ? "réservées" : "réservée"}`;

  return (
    <article
      data-testid="monitoring-day"
      data-date-key={day.dateKey}
      className="rounded-2xl border border-terroir-border bg-white p-5 shadow-soft"
    >
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-lg text-dark">{headline}</h3>
        <span className="text-sm text-dark/60">·</span>
        <span className="text-sm text-dark/60">{blocksLabel}</span>
        <span className="text-sm text-dark/60">·</span>
        <span className="text-sm text-dark/70" data-testid="day-fill-label">
          {fillLabel}
        </span>
      </header>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {day.blocks.map((block) => (
          <MonitoringBlockCard key={block.key} block={block} />
        ))}
      </div>
    </article>
  );
}

function MonitoringBlockCard({ block }: { block: MonitoringBlock }) {
  const fillLabel = `${block.reservedCount}/${block.totalCapacity} ${block.reservedCount > 1 ? "réservées" : "réservée"}`;

  return (
    <div
      data-testid="monitoring-block"
      data-block-key={block.key}
      className="rounded-xl border border-terroir-border bg-bg/40 p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-dark">{block.label}</span>
          <span
            className="rounded-full bg-dark/[0.06] px-2 py-0.5 text-xs text-dark/70"
            data-testid="block-duration"
          >
            {block.durationLabel}
          </span>
          {block.availabilityScope === "product_restricted" ? (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
              data-testid="block-reserved-product"
            >
              Réservé à un produit
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="grid grid-cols-8 gap-1"
        data-testid="monitoring-cells"
        aria-label={`Places : ${fillLabel}`}
      >
        {block.cells.map((cell, idx) => (
          <MonitoringCellNode
            key={`${block.key}-${idx}`}
            cell={cell}
            mode={block.mode}
          />
        ))}
      </div>

      <div className="mt-3 text-xs text-dark/60" data-testid="block-fill-label">
        {fillLabel}
      </div>
    </div>
  );
}

function MonitoringCellNode({
  cell,
  mode,
}: {
  cell: MonitoringCell;
  mode: "libre" | "rdv";
}) {
  const tooltip = formatCellTooltip(cell, mode);

  if (cell.kind === "reserved") {
    return (
      <Link
        href={`/commandes/${cell.orderId}`}
        data-testid="monitoring-cell-reserved"
        data-order-id={cell.orderId}
        title={tooltip}
        aria-label={tooltip}
        className="aspect-square rounded-sm bg-terra-700 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terra-700"
      />
    );
  }

  return (
    <div
      data-testid="monitoring-cell-free"
      title={tooltip}
      aria-label={tooltip}
      className="aspect-square rounded-sm border border-dark/15 bg-transparent"
    />
  );
}

function formatCellTooltip(cell: MonitoringCell, mode: "libre" | "rdv"): string {
  if (cell.kind === "reserved") {
    const consumer = cell.consumerFirstName ?? "Client";
    if (mode === "rdv") {
      return `${formatSlotTime(cell.subSlotStartIso)} · ${cell.orderNumber} · ${consumer}`;
    }
    return `${cell.orderNumber} · ${consumer}`;
  }
  // free
  if (mode === "rdv") {
    return `${formatSlotTime(cell.subSlotStartIso)} · libre`;
  }
  return "Place libre";
}

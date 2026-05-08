"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { CV_DATA, type CircuitNode } from "../_data/circuits";
import {
  buildRiverPath,
  computeEleveurShareGMS,
  computeNodeXPercents,
  computeNodeYPercents,
  formatPct,
  formatPctDecimal,
} from "../_lib/circuit-math";
import { CircuitIconSvg } from "./CircuitIcons";
import styles from "./CircuitVisualizer.module.css";

// CircuitVisualizer V2 — composant client interactif. Reproduit la maquette
// Claude Design (notre_demarche/circuit_visualizer_v2.html). Voir _data/
// pour les sources et _lib/circuit-math.ts pour les helpers de tracé.

type CircuitKey = "gms" | "terroir";

type TooltipState = {
  lane: CircuitKey;
  variant: "normal" | "disabled";
  nodeId: string;
  /** Pixels relatifs à la racine .cv (containing block du tooltip). */
  x: number;
  y: number;
};

const VIEWBOX_W = 1100;
const HEIGHT_GMS = 170;
const HEIGHT_TERROIR = 150;
const TERROIR_ELEVEUR_PCT = 75;

export function CircuitVisualizer() {
  const titleId = useId();
  const cvRef = useRef<HTMLElement>(null);

  const [disabledIds, setDisabledIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [pulseTick, setPulseTick] = useState(0);

  const eleveurShareGMS = useMemo(
    () => computeEleveurShareGMS(CV_DATA.gms, disabledIds),
    [disabledIds],
  );

  const toggle = useCallback((id: string) => {
    setDisabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPulseTick((t) => t + 1);
    setTooltip(null);
  }, []);

  const reset = useCallback(() => {
    setDisabledIds(new Set());
    setTooltip(null);
  }, []);

  const showTooltip = useCallback(
    (
      target: HTMLElement,
      lane: CircuitKey,
      nodeId: string,
      variant: "normal" | "disabled",
    ) => {
      const cv = cvRef.current;
      if (!cv) return;
      const cvRect = cv.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      setTooltip({
        lane,
        variant,
        nodeId,
        x: tRect.left + tRect.width / 2 - cvRect.left,
        y: tRect.top - cvRect.top,
      });
    },
    [],
  );

  const hideTooltip = useCallback(() => setTooltip(null), []);

  const hasDisabled = disabledIds.size > 0;

  const tooltipNode: CircuitNode | null = tooltip
    ? (tooltip.lane === "gms" ? CV_DATA.gms : CV_DATA.terroir).find(
        (n) => n.id === tooltip.nodeId,
      ) ?? null
    : null;

  return (
    <section className={styles.cv} aria-labelledby={titleId} ref={cvRef}>
      <header className={styles.header}>
        <div className={styles.eyebrow}>La chaîne de valeur</div>
        <h2 className={styles.title} id={titleId}>
          Sur 1 kg d&apos;entrecôte, qui touche <em>combien&nbsp;?</em>
        </h2>
        <p className={styles.sub}>
          Deux circuits, deux réalités économiques. Cliquez sur un maillon du
          circuit grande surface pour voir comment la part de l&apos;éleveur
          évolue lorsqu&apos;on retire des intermédiaires.
        </p>
      </header>

      <CircuitLane
        lane="gms"
        height={HEIGHT_GMS}
        nodes={CV_DATA.gms}
        disabledIds={disabledIds}
        eleveurShareGMS={eleveurShareGMS}
        pulseTick={pulseTick}
        showTooltip={showTooltip}
        hideTooltip={hideTooltip}
        onToggle={toggle}
        laneName={<>Grande surface</>}
        keyValue={formatPct(eleveurShareGMS)}
      />

      <CircuitLane
        lane="terroir"
        height={HEIGHT_TERROIR}
        nodes={CV_DATA.terroir}
        disabledIds={null}
        eleveurShareGMS={eleveurShareGMS}
        pulseTick={pulseTick}
        showTooltip={showTooltip}
        hideTooltip={hideTooltip}
        onToggle={null}
        laneName={
          <>
            Terr<em>O</em>ir
          </>
        }
        keyValue={formatPct(TERROIR_ELEVEUR_PCT)}
      />

      <div className={styles.controls}>
        <div className={styles.hint}>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v3.5M8 11h.01" />
          </svg>
          Cliquez un maillon de la grande surface pour le retirer · simulation
          pédagogique
        </div>
        <button
          type="button"
          className={styles.reset}
          onClick={reset}
          disabled={!hasDisabled}
          aria-disabled={!hasDisabled}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
            <path d="M2.5 2v3h3" />
          </svg>
          Réinitialiser le circuit
        </button>
      </div>

      <div className={styles.sources}>
        <p>
          Sources : FranceAgriMer / OFPM (Observatoire de la Formation des Prix
          et des Marges) · Idele · CGAAER. Données indicatives 2022-2024,
          moyennes filière bovine.
        </p>
        <p>
          Cette représentation simplifie une réalité économique complexe. La
          redistribution simulée suit une logique pédagogique, pas un calcul de
          marché réel.
        </p>
      </div>

      {tooltip && tooltipNode ? (
        <div
          className={`${styles.tooltip} ${styles.isVisible}`}
          role="tooltip"
          aria-hidden="false"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <TooltipContent
            variant={tooltip.variant}
            node={tooltipNode}
            isEleveurGMS={
              tooltip.lane === "gms" && tooltipNode.id === "eleveur"
            }
            eleveurShareGMS={eleveurShareGMS}
            hasDisabled={hasDisabled}
          />
        </div>
      ) : null}
    </section>
  );
}

// ── CircuitLane ────────────────────────────────────────────────────

type CircuitLaneProps = {
  lane: CircuitKey;
  height: number;
  nodes: ReadonlyArray<CircuitNode>;
  disabledIds: ReadonlySet<string> | null;
  eleveurShareGMS: number;
  pulseTick: number;
  showTooltip: (
    target: HTMLElement,
    lane: CircuitKey,
    nodeId: string,
    variant: "normal" | "disabled",
  ) => void;
  hideTooltip: () => void;
  onToggle: ((id: string) => void) | null;
  laneName: React.ReactNode;
  keyValue: string;
};

function CircuitLane({
  lane,
  height,
  nodes,
  disabledIds,
  eleveurShareGMS,
  pulseTick,
  showTooltip,
  hideTooltip,
  onToggle,
  laneName,
  keyValue,
}: CircuitLaneProps) {
  const xPercents = useMemo(
    () => computeNodeXPercents(nodes.length),
    [nodes.length],
  );
  const yPercents = useMemo(
    () => computeNodeYPercents(nodes.length),
    [nodes.length],
  );

  const pathD = useMemo(() => {
    const positionsX = xPercents.map((p) => (p / 100) * VIEWBOX_W);
    return buildRiverPath({ positionsX, height });
  }, [xPercents, height]);

  // Largeur du core stroke côté GMS = 4 + (eleveurShare/100) * 12
  const coreStrokeWidth = useMemo(() => {
    if (lane !== "gms") return 14;
    const w = 4 + (eleveurShareGMS / 100) * 12;
    return Number(w.toFixed(1));
  }, [lane, eleveurShareGMS]);

  const gradientId = `cv-grad-${lane}`;

  const onPctEnter = (e: MouseEvent<HTMLElement>, nodeId: string) => {
    showTooltip(e.currentTarget, lane, nodeId, "normal");
  };
  const onPctFocus = (e: FocusEvent<HTMLElement>, nodeId: string) => {
    showTooltip(e.currentTarget, lane, nodeId, "normal");
  };
  const onDiscEnter = (e: MouseEvent<HTMLElement>, nodeId: string) => {
    showTooltip(e.currentTarget, lane, nodeId, "disabled");
  };
  const onDiscFocus = (e: FocusEvent<HTMLElement>, nodeId: string) => {
    showTooltip(e.currentTarget, lane, nodeId, "disabled");
  };

  return (
    <div className={styles.lane} data-circuit={lane}>
      <div className={styles.laneHead}>
        <span className={styles.laneName}>{laneName}</span>
        <span className={styles.laneKey}>
          part de l&apos;éleveur · <strong>{keyValue}</strong>
        </span>
      </div>
      <div className={styles.stage} data-circuit={lane}>
        <div className={styles.stageInner}>
          <svg
            className={styles.svg}
            viewBox={`0 0 ${VIEWBOX_W} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              {lane === "gms" ? (
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2D6A4F" />
                  <stop offset="22%" stopColor="#A0522D" />
                  <stop offset="100%" stopColor="#A0522D" />
                </linearGradient>
              ) : (
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2D6A4F" />
                  <stop offset="60%" stopColor="#52B788" />
                  <stop offset="100%" stopColor="#A0522D" />
                </linearGradient>
              )}
            </defs>
            <path
              className={styles.river}
              d={pathD}
              fill="none"
              stroke={lane === "gms" ? "var(--terra-100)" : "var(--green-50)"}
              strokeWidth="28"
              strokeLinecap="round"
            />
            <path
              className={styles.river}
              d={pathD}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={coreStrokeWidth}
              strokeLinecap="round"
              opacity="0.9"
            />
            <path
              className={styles.river}
              d={pathD}
              fill="none"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>

          <div className={styles.nodes}>
            {nodes.map((node, i) => {
              const isDisabled =
                lane === "gms" && disabledIds?.has(node.id) === true;
              const isInteractive =
                lane === "gms" && node.role === "intermediary";
              const isConsumer = node.role === "consumer";
              const displayPct =
                lane === "gms" && node.id === "eleveur"
                  ? eleveurShareGMS
                  : node.pct;
              const isEleveurGMS = lane === "gms" && node.id === "eleveur";

              const positionStyle: CSSProperties = {
                left: `${xPercents[i]}%`,
                top: `${yPercents[i]}%`,
              };

              const buttonAriaLabel = isInteractive
                ? `${node.label}, ${formatPct(node.pct)}. ${
                    isDisabled
                      ? "Maillon retiré, cliquer pour le rétablir."
                      : "Cliquer pour retirer ce maillon."
                  }`
                : undefined;

              return (
                <div
                  key={node.id}
                  className={[styles.node, isDisabled ? styles.isDisabled : ""]
                    .filter(Boolean)
                    .join(" ")}
                  data-role={node.role}
                  data-id={node.id}
                  style={positionStyle}
                >
                  {isInteractive ? (
                    <button
                      type="button"
                      className={styles.nodeDisc}
                      aria-pressed={isDisabled}
                      aria-label={buttonAriaLabel}
                      onClick={() => onToggle?.(node.id)}
                      onMouseEnter={
                        isDisabled
                          ? (e) => onDiscEnter(e, node.id)
                          : undefined
                      }
                      onMouseLeave={isDisabled ? hideTooltip : undefined}
                      onFocus={
                        isDisabled
                          ? (e) => onDiscFocus(e, node.id)
                          : undefined
                      }
                      onBlur={isDisabled ? hideTooltip : undefined}
                    >
                      <CircuitIconSvg icon={node.icon} />
                      <span className={styles.cross} aria-hidden="true">
                        <svg
                          viewBox="0 0 40 40"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                        >
                          <path d="M10 10 L30 30 M30 10 L10 30" />
                        </svg>
                      </span>
                    </button>
                  ) : (
                    <div className={styles.nodeDisc}>
                      <CircuitIconSvg icon={node.icon} />
                    </div>
                  )}
                  <div className={styles.nodeLabel}>{node.label}</div>
                  {isConsumer ? (
                    <span
                      className={styles.nodePct}
                      aria-hidden="true"
                      style={{ visibility: "hidden" }}
                    >
                      —
                    </span>
                  ) : (
                    <span
                      key={isEleveurGMS ? `pulse-${pulseTick}` : "static"}
                      className={[
                        styles.nodePct,
                        isEleveurGMS && pulseTick > 0 ? styles.isPulsing : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      tabIndex={0}
                      onMouseEnter={(e) => onPctEnter(e, node.id)}
                      onMouseLeave={hideTooltip}
                      onFocus={(e) => onPctFocus(e, node.id)}
                      onBlur={hideTooltip}
                    >
                      {formatPct(displayPct)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TooltipContent ─────────────────────────────────────────────────

type TooltipContentProps = {
  variant: "normal" | "disabled";
  node: CircuitNode;
  isEleveurGMS: boolean;
  eleveurShareGMS: number;
  hasDisabled: boolean;
};

function TooltipContent({
  variant,
  node,
  isEleveurGMS,
  eleveurShareGMS,
  hasDisabled,
}: TooltipContentProps) {
  if (variant === "disabled") {
    return (
      <>
        <div className={styles.tooltipTitle}>{node.label} · retiré</div>
        <div className={styles.tooltipFoot}>
          Simulation pédagogique. La redistribution réelle suit une logique
          économique plus complexe.
        </div>
      </>
    );
  }

  const sources = node.sources ?? [];
  const mean =
    sources.length > 0
      ? sources.reduce((sum, [, v]) => sum + v, 0) / sources.length
      : node.pct;
  const displayed = isEleveurGMS ? eleveurShareGMS : node.pct;
  const showRedistribLine = isEleveurGMS && hasDisabled;

  return (
    <>
      <div className={styles.tooltipTitle}>{node.label}</div>
      {sources.map(([src, v]) => (
        <div key={src} className={styles.tooltipRow}>
          <span>{src}</span>
          <span>{formatPct(v)}</span>
        </div>
      ))}
      {sources.length > 1 ? (
        <div className={`${styles.tooltipRow} ${styles.isMean}`}>
          <span>Moyenne affichée</span>
          <span>{formatPctDecimal(mean)}</span>
        </div>
      ) : null}
      {showRedistribLine ? (
        <div className={styles.tooltipFoot}>
          Inclut la redistribution simulée (+{formatPct(displayed - node.pct)}
          ).
        </div>
      ) : null}
    </>
  );
}

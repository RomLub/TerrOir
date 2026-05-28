import type { CircuitIcon } from "../_data/circuits";

// Set d'icônes Feather-like 24x24 utilisé par CircuitVisualizer V2.
// Paths repris 1:1 de la maquette Claude Design (lignes 506-516).

const ICON_PATHS: Record<CircuitIcon, React.ReactNode> = {
  cow: (
    <>
      <path d="M5 8c0-2 1.5-3 3-3 1 0 1.5.5 2 1h4c.5-.5 1-1 2-1 1.5 0 3 1 3 3 0 .5-.2 1-.5 1.5" />
      <path d="M7 9c-1 0-2 1-2 3v2c0 3 2 5 4 5h6c2 0 4-2 4-5v-2c0-2-1-3-2-3" />
      <circle cx="9.5" cy="13" r=".5" fill="currentColor" />
      <circle cx="14.5" cy="13" r=".5" fill="currentColor" />
      <path d="M11 16h2" />
    </>
  ),
  handshake: (
    <>
      <path d="M3 11l4-4 3 1 4-1 3 1 4 4" />
      <path d="M7 14l3 3 2-1 2 1 3-3" />
      <path d="M10 16v3M14 16v3" />
    </>
  ),
  factory: (
    <>
      <path d="M3 20V11l5 3V11l5 3V8l8 12H3z" />
      <path d="M7 16h.01M11 16h.01M15 16h.01M18 16h.01" />
    </>
  ),
  knife: (
    <>
      <path d="M3 17l11-11 5 1 1 5-11 11-3-3-3-3z" />
      <path d="M3 17l3 3" />
    </>
  ),
  truck: (
    <>
      <path d="M2 17V7h11v10" />
      <path d="M13 10h4l4 4v3h-2" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  box: (
    <>
      <path d="M3 8l9-4 9 4v9l-9 4-9-4V8z" />
      <path d="M3 8l9 4 9-4M12 12v9" />
    </>
  ),
  store: (
    <>
      <path d="M3 9l1.5-4h15L21 9" />
      <path d="M3 9v11h18V9" />
      <path d="M3 9c0 1.5 1 3 3 3s3-1.5 3-3M9 9c0 1.5 1 3 3 3s3-1.5 3-3M15 9c0 1.5 1 3 3 3s3-1.5 3-3" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19c-1-7 3-13 14-14-1 11-7 15-14 14z" />
      <path d="M5 19l9-9" />
    </>
  ),
};

export function CircuitIconSvg({ icon }: { icon: CircuitIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[icon]}
    </svg>
  );
}

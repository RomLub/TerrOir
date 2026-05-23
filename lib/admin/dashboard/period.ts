// Chantier 2 — périodes du bandeau temporel du dashboard admin. L'offset vit
// en query param `?period=today|week|month|year` ; les bornes réelles sont
// calculées côté SQL (RPC get_admin_dashboard, en Europe/Paris) — ici on ne
// gère que le parsing + les libellés FR.

export const DASHBOARD_PERIODS = ["today", "week", "month", "year"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: "Aujourd'hui",
  week: "Cette semaine",
  month: "Ce mois-ci",
  year: "Cette année",
};

/**
 * Parse le query param `period`. Valeur absente / invalide → 'today'
 * (fail-safe : un param trafiqué ne casse pas le rendu).
 */
export function parseDashboardPeriod(
  raw: string | string[] | undefined,
): DashboardPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return DASHBOARD_PERIODS.includes(value as DashboardPeriod)
    ? (value as DashboardPeriod)
    : "today";
}

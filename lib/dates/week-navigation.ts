// Navigation par semaine (chantier 10) — bornes de dates ISO-week pour le
// dashboard producteur et la page revenus.
//
// L'offset de semaine vit en query param (`?week=-1`, `?week=2`, ...). Ces
// helpers purs traduisent un offset en bornes de dates exploitables côté
// query / RPC, sans dépendance React ni I/O — testables unitairement.
//
// Convention semaine : lundi 00:00 → lundi 00:00 (ISO 8601, comme
// l'existant inline dans dashboard/page.tsx et revenus/page.tsx avant
// extraction).

/**
 * Offset de semaine borné. On limite la navigation pour éviter qu'un offset
 * absurde (ex. `?week=999999`) ne génère des bornes hors de toute donnée
 * utile et ne déclenche des scans inutiles. 52 semaines de part et d'autre
 * couvrent largement le besoin produit (un an d'historique / prévision).
 */
export const MAX_WEEK_OFFSET = 52;
export const MIN_WEEK_OFFSET = -52;

/**
 * Parse l'offset de semaine depuis une valeur de query param brute.
 *
 * - Absent / vide / non numérique → 0 (semaine courante).
 * - Décimal → tronqué vers l'entier (parseInt-like via Math.trunc).
 * - Hors bornes → clampé dans [MIN_WEEK_OFFSET, MAX_WEEK_OFFSET].
 *
 * Fail-safe : ne jette jamais — un param malformé retombe sur la semaine
 * courante plutôt que de casser le rendu de la page.
 */
export function parseWeekOffset(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value.trim() === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const truncated = Math.trunc(n);
  if (truncated > MAX_WEEK_OFFSET) return MAX_WEEK_OFFSET;
  if (truncated < MIN_WEEK_OFFSET) return MIN_WEEK_OFFSET;
  return truncated;
}

/** Début de semaine (lundi 00:00 local) pour une date donnée. */
export function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7; // 0 = lundi
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - day);
  return copy;
}

/** Ajoute `n` jours (n peut être négatif). */
export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Début de journée (00:00 local). */
export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Début de la semaine ciblée par l'offset, calculé depuis `now`.
 * offset 0 = semaine courante, -1 = semaine précédente, +1 = suivante.
 */
export function weekStartForOffset(now: Date, weekOffset: number): Date {
  return addDays(startOfWeek(now), weekOffset * 7);
}

/** Slice YYYY-MM-DD d'une date en heure locale (pas UTC). */
function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Bornes ISO-week pour la RPC `get_producer_dashboard`.
 *
 * Décision design (chantier 10) : seules les bornes **scopées semaine**
 * (planning + revenus semaine + comparaison semaine précédente) suivent
 * l'offset. Les ancres opérationnelles « live » (today/yesterday/tomorrow,
 * prochains retraits, alertes stock) restent ancrées sur le **vrai now** —
 * « commandes aujourd'hui » n'a aucun sens pour une semaine passée. Le
 * `today_iso` (highlight « aujourd'hui » dans la grille) reste donc le vrai
 * jour : il ne surligne aucune case quand on consulte une autre semaine,
 * ce qui est le comportement attendu.
 *
 * Les bornes timestamptz sont émises en ISO (UTC) — la conversion en heure
 * Paris se fait côté SQL/affichage comme dans l'existant.
 */
export function computeDashboardBounds(now: Date, weekOffset: number) {
  const todayStart = startOfDay(now);
  const yesterdayStart = addDays(todayStart, -1);
  const tomorrowStart = addDays(todayStart, 1);

  const weekStart = weekStartForOffset(now, weekOffset);
  const weekEnd = addDays(weekStart, 7);
  const lastWeekStart = addDays(weekStart, -7);

  // Marge 1 jour de part et d'autre pour absorber les edge cases TZ
  // (weekStart en UTC vs slots.starts_at en Paris), comme l'inline original.
  const slotsRangeStart = addDays(weekStart, -1);
  const slotsRangeEnd = addDays(weekEnd, 1);

  return {
    todayStart,
    yesterdayStart,
    tomorrowStart,
    weekStart,
    weekEnd,
    lastWeekStart,
    slotsRangeStart,
    slotsRangeEnd,
    // ISO date (YYYY-MM-DD) — today reste le vrai jour ; week en heure locale.
    todayIso: localDateIso(todayStart),
    weekStartIso: localDateIso(weekStart),
    weekEndIso: localDateIso(weekEnd),
  };
}

export type DashboardBounds = ReturnType<typeof computeDashboardBounds>;

/**
 * Fenêtre de 8 semaines ISO pour le graphe revenus, terminant sur la
 * semaine ciblée par l'offset. offset 0 → 8 dernières semaines (semaine
 * courante incluse en dernière barre). offset -1 → décalées d'une semaine
 * vers le passé, etc.
 *
 * Retourne les débuts de semaine du plus ancien au plus récent (8 entrées)
 * plus la borne basse `rangeStart` (= premier weekStart) pour filtrer la
 * query orders.
 */
export function computeRevenueWeekWindow(now: Date, weekOffset: number) {
  const targetWeekStart = weekStartForOffset(now, weekOffset);
  const weekStarts: Date[] = [];
  for (let i = 7; i >= 0; i--) {
    weekStarts.push(addDays(targetWeekStart, -i * 7));
  }
  return {
    weekStarts,
    rangeStart: weekStarts[0]!,
    rangeEnd: addDays(targetWeekStart, 7),
  };
}

/**
 * Libellé lisible d'une semaine, du lundi au dimanche inclus, à partir de
 * son début (`weekStart`). Ex. « 19 – 25 mai », « 28 avril – 4 mai » quand
 * la semaine chevauche deux mois. Utilisé par le WeekNavigator.
 */
export function formatWeekRangeLabel(weekStart: Date): string {
  const start = startOfDay(weekStart);
  const end = addDays(start, 6); // dimanche inclus
  const sameMonth = start.getMonth() === end.getMonth();
  const fmtMonth = (d: Date) =>
    d.toLocaleDateString('fr-FR', { month: 'long' });
  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} ${fmtMonth(end)}`;
  }
  return `${start.getDate()} ${fmtMonth(start)} – ${end.getDate()} ${fmtMonth(end)}`;
}

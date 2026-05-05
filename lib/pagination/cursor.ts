// Pagination cursor (created_at DESC + id DESC tie-breaker) pour les
// listings paginés (consumer commandes, producer commandes, admin
// gestion-producteurs). Audit perf-postgres-2026-05-05 M-2 + NEW-1.
//
// L'usage canonique côté Client Component :
//   const sp = useSearchParams();
//   const cursor = parseCursor(sp);
//   const items = applyCursor(supabase.from(...).select(...).eq(...), cursor)
//     .order('created_at', { ascending: false })
//     .order('id', { ascending: false })
//     .limit(100);
//   const nextHref = lastItem ? buildCursorUrl(basePath, lastItem) : null;

export type ParsedCursor = {
  before: string | null;
  beforeId: string | null;
};

// Lecture compatible avec ReadonlyURLSearchParams (Next.js
// useSearchParams) et URLSearchParams natif. Le couple
// (before, beforeId) est valide uniquement si les deux sont présents :
// un cursor partiel est ignoré (équivaut à pas de cursor).

type SearchParamsLike = { get(name: string): string | null };

export function parseCursor(searchParams: SearchParamsLike): ParsedCursor {
  const before = searchParams.get('before');
  const beforeId = searchParams.get('before_id');
  if (!before || !beforeId) {
    return { before: null, beforeId: null };
  }
  return { before, beforeId };
}

// Construit l'URL "Charger les 100 plus anciennes" à partir du dernier
// item rendu. created_at + id de cet item deviennent le cursor exclusif
// pour la page suivante.

export function buildCursorUrl(
  basePath: string,
  lastItem: { created_at: string; id: string },
): string {
  const params = new URLSearchParams();
  params.set('before', lastItem.created_at);
  params.set('before_id', lastItem.id);
  return `${basePath}?${params.toString()}`;
}

// Type structurel minimal : `lt` et `or` du chain PostgREST.
// Évite d'importer PostgrestFilterBuilder (sous-dépendance non utilisée
// directement ailleurs dans le repo) tout en gardant le retour typé.

interface CursorChain<T> {
  lt(column: string, value: string): T;
  or(filters: string): T;
}

// Applique le couple (created_at < before) OR (created_at = before AND
// id < beforeId) — tie-breaker sur l'id pour gérer les égalités de
// timestamp (créations en batch dans la même milliseconde). Sans cursor,
// la query est retournée inchangée.

export function applyCursor<T extends CursorChain<T>>(
  query: T,
  cursor: ParsedCursor,
): T {
  if (!cursor.before || !cursor.beforeId) {
    return query;
  }
  return query.or(
    `created_at.lt.${cursor.before},and(created_at.eq.${cursor.before},id.lt.${cursor.beforeId})`,
  );
}

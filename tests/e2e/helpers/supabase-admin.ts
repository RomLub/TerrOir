/**
 * Helpers Supabase admin sécurisés pour tests E2E.
 *
 * 4 fonctions whitelist : safeInsert, safeUpdate, safeDelete, safeUpsert.
 * Chaque helper :
 *   - Vérifie email via assertSafeEmail() si payload/filter contient email
 *   - Vérifie id/user_id contre l'union (trackedUserIds ∪ trackedRowIds)
 *     pour update/delete
 *   - Refuse update/delete avec filter vide
 *   - Log JSONL audit
 *   - Exécute via client raw Supabase service_role
 *
 * Pas de Proxy magique : 100% explicite, debuggable, self-documenting.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { assertSafeEmail } from './guards';
import { writeAuditLog } from './audit-log';

export class UnsafeWriteError extends Error {
  constructor(message: string) {
    super(`\n🛑 UNSAFE WRITE BLOCKED 🛑\n   ${message}\n`);
    this.name = 'UnsafeWriteError';
  }
}

export interface TestContext {
  /** UUID stable pour toute la session Playwright. */
  runId: string;
  /** Identifiant du test courant (titre Playwright). */
  testId: string;
  /** UUIDs auth.users + public.users créés par ce test. Cleanup via auth.admin.deleteUser cascade. */
  trackedUserIds: Set<string>;
  /** UUIDs de rows applicatives (ex: email_change_otp_codes) créés par ce test. Cleanup via cascade FK depuis l'user parent. */
  trackedRowIds: Set<string>;
  /** Set des emails créés par ce test (pour cleanup et logs). */
  trackedEmails: Set<string>;
}

let _rawClient: SupabaseClient | null = null;

/**
 * Récupère le client Supabase admin brut (service_role).
 * Singleton : créé à la première demande, réutilisé ensuite.
 */
export function getRawAdminClient(): SupabaseClient {
  if (_rawClient) return _rawClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL manquant dans .env.local');
  }
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local. ' +
      'Récupère-le depuis Supabase Studio > Settings > API.',
    );
  }
  _rawClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _rawClient;
}

/**
 * READ-ONLY admin client. NE JAMAIS utiliser pour des writes.
 *
 * Pour les writes : utiliser safeInsert/safeUpdate/safeDelete/safeUpsert
 * qui passent par les garde-fous (assertSafeEmail, tracking IDs, audit log).
 *
 * Cette fonction est un alias public de getRawAdminClient pour rendre
 * le mauvais usage immédiatement visible à la lecture du code de test.
 */
export function getReadOnlyAdminClient(): SupabaseClient {
  return getRawAdminClient();
}

/**
 * Reset du singleton (utile pour tests vitest).
 */
export function __resetRawClient(): void {
  _rawClient = null;
}

// ========================================================================
// Validation interne (factorisée entre helpers)
// ========================================================================

function validatePayloadEmail(payload: Record<string, unknown> | Record<string, unknown>[]): void {
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const row of rows) {
    if (row && typeof row.email === 'string') {
      assertSafeEmail(row.email);
    }
  }
}

function validateFilterEmail(filter: Record<string, unknown>): void {
  if (typeof filter.email === 'string') {
    assertSafeEmail(filter.email);
  }
  if (Array.isArray(filter.email)) {
    for (const v of filter.email) {
      if (typeof v === 'string') assertSafeEmail(v);
    }
  }
}

function validateFilterIdTracking(
  ctx: TestContext,
  table: string,
  op: string,
  filter: Record<string, unknown>,
): void {
  for (const idCol of ['id', 'user_id']) {
    const val = filter[idCol];
    if (val === undefined) continue;

    const values = Array.isArray(val) ? val : [val];
    for (const v of values) {
      const isTracked =
        typeof v === 'string' && (ctx.trackedUserIds.has(v) || ctx.trackedRowIds.has(v));
      if (!isTracked) {
        const allTracked = [...ctx.trackedUserIds, ...ctx.trackedRowIds];
        throw new UnsafeWriteError(
          `${op.toUpperCase()} sur ${table} avec ${idCol}=${v} ` +
          `non tracké dans le test "${ctx.testId}". ` +
          `IDs trackés : [${allTracked.join(', ') || 'aucun'}]`,
        );
      }
    }
  }
}

function assertFilterNotEmpty(table: string, op: string, filter: Record<string, unknown>): void {
  if (Object.keys(filter).length === 0) {
    throw new UnsafeWriteError(`${op.toUpperCase()} sur ${table} sans aucun filtre. Refusé.`);
  }
}

/**
 * Applique un filter sur un query builder Supabase.
 * Supporte les valeurs scalaires (.eq) et les arrays (.in).
 */
function applyFilter(builder: any, filter: Record<string, unknown>): any {
  let result = builder;
  for (const [col, val] of Object.entries(filter)) {
    if (Array.isArray(val)) {
      result = result.in(col, val);
    } else {
      result = result.eq(col, val);
    }
  }
  return result;
}

// ========================================================================
// 4 helpers publics : safeInsert, safeUpdate, safeDelete, safeUpsert
// ========================================================================

interface SafeInsertOptions {
  /** Si true, retourne les rows insérés via .select() */
  returning?: boolean;
}

export async function safeInsert<T = unknown>(
  ctx: TestContext,
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
  options: SafeInsertOptions = {},
): Promise<{ data: T | T[] | null; error: unknown }> {
  validatePayloadEmail(payload);

  const client = getRawAdminClient();
  let query: any = client.from(table).insert(payload as any);
  if (options.returning) {
    query = query.select();
  }

  const result = await query;

  await writeAuditLog({
    runId: ctx.runId,
    ts: new Date().toISOString(),
    test: ctx.testId,
    table,
    op: 'insert',
    filter: { rows_count: Array.isArray(payload) ? payload.length : 1 },
    rows_affected: Array.isArray(result.data) ? result.data.length : result.data ? 1 : null,
  });

  return result;
}

export async function safeUpdate<T = unknown>(
  ctx: TestContext,
  table: string,
  payload: Record<string, unknown>,
  filter: Record<string, unknown>,
): Promise<{ data: T | T[] | null; error: unknown }> {
  assertFilterNotEmpty(table, 'update', filter);
  validatePayloadEmail(payload);
  validateFilterEmail(filter);
  validateFilterIdTracking(ctx, table, 'update', filter);

  const client = getRawAdminClient();
  const builder = client.from(table).update(payload as any);
  const filtered = applyFilter(builder, filter);
  const result = await filtered;

  await writeAuditLog({
    runId: ctx.runId,
    ts: new Date().toISOString(),
    test: ctx.testId,
    table,
    op: 'update',
    filter,
    rows_affected: Array.isArray(result.data) ? result.data.length : result.data ? 1 : null,
  });

  return result;
}

export async function safeDelete(
  ctx: TestContext,
  table: string,
  filter: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> {
  assertFilterNotEmpty(table, 'delete', filter);
  validateFilterEmail(filter);
  validateFilterIdTracking(ctx, table, 'delete', filter);

  const client = getRawAdminClient();
  const builder = client.from(table).delete();
  const filtered = applyFilter(builder, filter);
  const result = await filtered;

  await writeAuditLog({
    runId: ctx.runId,
    ts: new Date().toISOString(),
    test: ctx.testId,
    table,
    op: 'delete',
    filter,
    rows_affected: Array.isArray(result.data) ? result.data.length : result.data ? 1 : null,
  });

  return result;
}

interface SafeUpsertOptions {
  onConflict?: string;
  returning?: boolean;
}

export async function safeUpsert<T = unknown>(
  ctx: TestContext,
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
  options: SafeUpsertOptions = {},
): Promise<{ data: T | T[] | null; error: unknown }> {
  validatePayloadEmail(payload);

  const client = getRawAdminClient();
  let query: any = client.from(table).upsert(payload as any, {
    onConflict: options.onConflict,
  });
  if (options.returning) {
    query = query.select();
  }

  const result = await query;

  await writeAuditLog({
    runId: ctx.runId,
    ts: new Date().toISOString(),
    test: ctx.testId,
    table,
    op: 'upsert',
    filter: { rows_count: Array.isArray(payload) ? payload.length : 1 },
    rows_affected: Array.isArray(result.data) ? result.data.length : result.data ? 1 : null,
  });

  return result;
}

// ========================================================================
// Helpers de tracking
// ========================================================================

function assertNonEmptyId(id: string, fnName: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${fnName}: id invalide (${id})`);
  }
}

/** Track un UUID auth.users + public.users. Cleanup via auth.admin.deleteUser cascade. */
export function trackUserId(ctx: TestContext, id: string): void {
  assertNonEmptyId(id, 'trackUserId');
  ctx.trackedUserIds.add(id);
}

/** Track un UUID de row applicative (ex: email_change_otp_codes). Cleanup via cascade FK depuis l'user parent. */
export function trackRowId(ctx: TestContext, id: string): void {
  assertNonEmptyId(id, 'trackRowId');
  ctx.trackedRowIds.add(id);
}

export function trackEmail(ctx: TestContext, email: string): void {
  assertSafeEmail(email);
  ctx.trackedEmails.add(email);
}

/** Retire un UUID des deux sets (no-op si pas de match). */
export function untrackId(ctx: TestContext, id: string): void {
  ctx.trackedUserIds.delete(id);
  ctx.trackedRowIds.delete(id);
}

/**
 * Audit log JSONL des writes effectués par les tests E2E.
 * Format : 1 ligne JSON par write, append-only, gitignored.
 *
 * Permet le debug post-mortem : "qu'est-ce qui a été écrit pendant
 * ce run, par quel test, sur quelle table, avec quel filtre ?"
 */

import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export const AUDIT_LOG_PATH = 'tests/e2e/.audit-log.jsonl';

export interface AuditLogEntry {
  runId: string;
  ts: string;
  test: string;
  table: string;
  op: 'insert' | 'update' | 'delete' | 'upsert';
  filter: Record<string, unknown>;
  rows_affected: number | null;
}

/**
 * Crée un runId stable pour toute la session Playwright.
 * Format : r-YYYY-MM-DD-HH-mm-ss-{8 hex}
 */
export function createRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const rand = randomUUID().split('-')[0];
  return `r-${date}-${time}-${rand}`;
}

/**
 * Append une entrée au log audit. Failure ne bloque jamais le test
 * (sinon on risque de masquer un vrai problème).
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await mkdir(dirname(AUDIT_LOG_PATH), { recursive: true });
    await appendFile(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    console.error('[audit-log] write failed:', err);
  }
}

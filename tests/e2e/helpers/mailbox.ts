/**
 * Mailbox helper E2E — lit les emails capturés dans test_emails_captured
 * (alimentée par lib/resend/send.ts quand RESEND_TEST_MODE=true).
 *
 * Pas de dépendance à Resend en runtime : la table joue le rôle de boîte
 * de réception virtuelle pour les assertions Playwright.
 *
 * Patterns d'usage :
 *
 *   const mail = await waitForCapturedEmail(ctx, {
 *     to: user.email,
 *     template: 'email-change-otp-current',
 *     timeoutMs: 5000,
 *   });
 *   expect(mail.html).toContain('123456');
 *
 * Garde-fou : assertSafeEmail systématique sur to_email pour cohérence
 * avec le reste du repo (allow-list playwright-test-{ts}@mailinator.com).
 */

import { assertSafeEmail } from './guards';
import { getRawAdminClient, type TestContext } from './supabase-admin';

export interface CapturedEmail {
  id: string;
  to_email: string;
  from_email: string;
  subject: string;
  template: string;
  html: string | null;
  metadata: Record<string, unknown>;
  user_id: string | null;
  captured_at: string;
}

interface WaitOptions {
  /** Email destinataire (allow-list playwright-test-* obligatoire). */
  to: string;
  /** Template exact (ex: 'order-confirmed-consumer'). Optionnel. */
  template?: string;
  /** Subject substring matcher. Optionnel. */
  subject?: string | RegExp;
  /** Filtre captured_at >= since (date/iso). Default: 5min ago pour éviter les rows d'un test précédent. */
  since?: Date | string;
  /** Timeout total avant throw. Default: 10000. */
  timeoutMs?: number;
  /** Intervalle polling. Default: 250. */
  pollMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 250;
const DEFAULT_SINCE_OFFSET_MS = 5 * 60_000;

function toIso(d: Date | string | undefined): string {
  if (d === undefined) return new Date(Date.now() - DEFAULT_SINCE_OFFSET_MS).toISOString();
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function subjectMatches(subject: string, matcher: string | RegExp): boolean {
  if (typeof matcher === 'string') return subject.includes(matcher);
  return matcher.test(subject);
}

/**
 * Attend qu'un email matchant les filtres apparaisse dans la table capture.
 * Throw après timeout si aucun match.
 *
 * @param _ctx accepté pour cohérence d'interface (helpers ctx-aware), pas utilisé en interne.
 */
export async function waitForCapturedEmail(
  _ctx: TestContext,
  options: WaitOptions,
): Promise<CapturedEmail> {
  assertSafeEmail(options.to);

  const sinceIso = toIso(options.since);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const admin = getRawAdminClient();

  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;

  while (Date.now() < deadline) {
    let query = admin
      .from('test_emails_captured')
      .select('*')
      .eq('to_email', options.to)
      .gte('captured_at', sinceIso)
      .order('captured_at', { ascending: false })
      .limit(20);

    if (options.template) {
      query = query.eq('template', options.template);
    }

    const { data, error } = await query;
    if (error) {
      lastError = error.message;
    } else if (data && data.length > 0) {
      const matches = options.subject
        ? data.filter((row) => subjectMatches(row.subject as string, options.subject!))
        : data;
      if (matches.length > 0) {
        return matches[0] as CapturedEmail;
      }
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  const filterDesc = [
    `to=${options.to}`,
    options.template ? `template=${options.template}` : null,
    options.subject ? `subject=${String(options.subject)}` : null,
    `since=${sinceIso}`,
  ]
    .filter(Boolean)
    .join(' ');
  throw new Error(
    `waitForCapturedEmail timeout après ${timeoutMs}ms — filtres : { ${filterDesc} }${
      lastError ? ` | last DB error: ${lastError}` : ''
    }`,
  );
}

/**
 * Liste tous les emails capturés matchant les filtres. Pas de polling.
 * Utile pour les assertions négatives ("aucun email envoyé") et le debug.
 */
export async function listCapturedEmails(
  _ctx: TestContext,
  options: Omit<WaitOptions, 'timeoutMs' | 'pollMs'>,
): Promise<CapturedEmail[]> {
  assertSafeEmail(options.to);

  const sinceIso = toIso(options.since);
  const admin = getRawAdminClient();

  let query = admin
    .from('test_emails_captured')
    .select('*')
    .eq('to_email', options.to)
    .gte('captured_at', sinceIso)
    .order('captured_at', { ascending: false });

  if (options.template) {
    query = query.eq('template', options.template);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`listCapturedEmails failed: ${error.message}`);
  }
  const rows = (data ?? []) as CapturedEmail[];
  return options.subject
    ? rows.filter((row) => subjectMatches(row.subject, options.subject!))
    : rows;
}

/**
 * Purge tous les emails capturés pour un destinataire. Utilisé en cleanup
 * scoped test si nécessaire (le global-teardown sweep par préfixe couvre
 * le cas général).
 */
export async function clearCapturedEmails(
  _ctx: TestContext,
  toEmail: string,
): Promise<number> {
  assertSafeEmail(toEmail);
  const admin = getRawAdminClient();

  const { data, error } = await admin
    .from('test_emails_captured')
    .delete()
    .eq('to_email', toEmail)
    .select('id');
  if (error) {
    throw new Error(`clearCapturedEmails failed: ${error.message}`);
  }
  return data?.length ?? 0;
}

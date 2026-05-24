import "server-only";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveInboundTag } from "./tag";
import { isIgnoredSender } from "./ignored-senders";
import { htmlToPlainText } from "./html-to-text";

// Chantier 9 — ingestion IMAP des emails entrants (cf. ADR-0010, option A).
//
// Doctrine (points Romain) :
//   - Lecture SEULE : on ouvre INBOX en readonly, on ne touche jamais les
//     flags (Zimbra/OVH gère son état \Seen en parallèle).
//   - Reprise par checkpoint : on stocke le dernier UID traité par compte
//     (inbound_email_accounts.last_seen_uid) ; on ne re-scanne pas l'historique.
//   - UIDVALIDITY : si le serveur la change, les UID sont invalidés → on
//     re-checkpoint proprement (clean start, pas de réimport massif).
//   - Premier run (checkpoint 0) : on NE réimporte PAS l'historique de la
//     boîte ; on cale le checkpoint sur uidNext-1 (les anciens mails restent
//     consultables dans le webmail OVH). On ingère à partir du prochain reçu.
//   - Déduplication par Message-ID (upsert ignoreDuplicates).
//
// Cap de sécurité : MAX_PER_RUN messages par exécution (le reste au run
// suivant, le checkpoint avance). Évite un fetch géant qui timeout.

const MAX_PER_RUN = 50;

export type ImapConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
};

// Résolution des identifiants IMAP. MVP : un seul compte via les env IMAP_*.
// Multi-comptes (extension triviale) : résoudre par adresse (ex. env suffixées)
// — non implémenté au MVP, documenté dans ADR-0010.
export function getImapConfig(): ImapConfig | null {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  const port = Number(process.env.IMAP_PORT ?? "993");
  if (!host || !user || !pass) return null;
  return { host, port, user, pass };
}

type AccountRow = {
  id: string;
  address: string;
  last_seen_uid: number;
  uid_validity: number | null;
};

export type PollResult = {
  account: string;
  fetched: number;
  inserted: number;
  reset: boolean;
  error: string | null;
};

// Ingestion pour UN compte (client IMAP injectable pour les tests).
export async function pollAccount(
  admin: SupabaseClient,
  account: AccountRow,
  config: ImapConfig,
  clientFactory: (cfg: ImapConfig) => ImapFlow = defaultClientFactory,
): Promise<PollResult> {
  const client = clientFactory(config);
  let fetched = 0;
  let inserted = 0;
  let reset = false;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mb = client.mailbox;
      const uidNext =
        mb && typeof mb !== "boolean" ? Number(mb.uidNext ?? 0) : 0;
      const uidValidity =
        mb && typeof mb !== "boolean" ? Number(mb.uidValidity ?? 0) : 0;

      // Clean start : checkpoint 0 (jamais ingéré) ou UIDVALIDITY changée.
      const validityChanged =
        account.uid_validity != null && account.uid_validity !== uidValidity;
      if (account.last_seen_uid === 0 || validityChanged) {
        const checkpoint = Math.max(0, uidNext - 1);
        await admin
          .from("inbound_email_accounts")
          .update({
            last_seen_uid: checkpoint,
            uid_validity: uidValidity,
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);
        return { account: account.address, fetched: 0, inserted: 0, reset: true, error: null };
      }

      const start = account.last_seen_uid + 1;
      let maxUid = account.last_seen_uid;

      for await (const msg of client.fetch(
        `${start}:*`,
        { uid: true, source: true },
        { uid: true },
      )) {
        if (fetched >= MAX_PER_RUN) break;
        const uid = Number(msg.uid);
        if (uid > maxUid) maxUid = uid;
        if (!msg.source) continue;
        fetched += 1;

        const parsed = await simpleParser(msg.source as Buffer);
        const fromAddr = parsed.from?.value?.[0];
        const fromEmail = (fromAddr?.address ?? "").toLowerCase();
        if (!fromEmail) continue;
        // Pré-filtre bruit infra/bounces/outbound (checkpoint déjà avancé via
        // maxUid → on ne re-traitera pas ce mail).
        if (isIgnoredSender(fromEmail)) continue;
        const messageId =
          parsed.messageId ?? `imap-${account.address}-${uid}`;
        const { tag, lookupUserId, lookupLeadId } = await resolveInboundTag(
          admin,
          fromEmail,
        );

        const toAddr = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to;
        const htmlBody = typeof parsed.html === "string" ? parsed.html : null;
        // Fallback : si pas de partie texte (mail HTML-only), dériver un texte
        // lisible du HTML (sinon la fiche /mails afficherait du vide).
        const textBody = (parsed.text ?? "").trim() || htmlToPlainText(htmlBody) || null;
        const { error: insErr } = await admin
          .from("inbound_emails")
          .upsert(
            {
              account_id: account.id,
              message_id: messageId,
              in_reply_to: parsed.inReplyTo ?? null,
              from_email: fromEmail,
              from_name: fromAddr?.name || null,
              to_email: toAddr?.text ?? account.address,
              subject: parsed.subject ?? null,
              body_text: textBody,
              body_html: htmlBody,
              received_at: (parsed.date ?? new Date()).toISOString(),
              tag,
              lookup_user_id: lookupUserId,
              lookup_lead_id: lookupLeadId,
              raw: { uid, headers_subject: parsed.subject ?? null },
            },
            { onConflict: "message_id", ignoreDuplicates: true },
          )
          .select("id");
        if (!insErr) inserted += 1;
      }

      if (maxUid > account.last_seen_uid) {
        await admin
          .from("inbound_email_accounts")
          .update({
            last_seen_uid: maxUid,
            uid_validity: uidValidity,
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);
      }
    } finally {
      lock.release();
    }
    await client.logout();
    return { account: account.address, fetched, inserted, reset, error: null };
  } catch (err) {
    try {
      await client.logout();
    } catch {
      /* déjà fermé */
    }
    return {
      account: account.address,
      fetched,
      inserted,
      reset,
      error: (err as Error).message,
    };
  }
}

function defaultClientFactory(cfg: ImapConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
}

// Boucle sur les comptes activés. MVP : config IMAP unique (env), appliquée au
// compte dont l'adresse == IMAP_USER.
export async function pollInbound(admin: SupabaseClient): Promise<PollResult[]> {
  const config = getImapConfig();
  if (!config) {
    return [
      { account: "(none)", fetched: 0, inserted: 0, reset: false, error: "IMAP env vars manquantes" },
    ];
  }

  const { data: accounts } = await admin
    .from("inbound_email_accounts")
    .select("id, address, last_seen_uid, uid_validity")
    .eq("enabled", true);

  const results: PollResult[] = [];
  for (const account of (accounts ?? []) as AccountRow[]) {
    // MVP : on ne traite que le compte correspondant aux identifiants env.
    if (account.address.toLowerCase() !== config.user.toLowerCase()) continue;
    results.push(await pollAccount(admin, account, config));
  }
  return results;
}

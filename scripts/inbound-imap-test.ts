/**
 * Chantier 9 — diagnostic IMAP de la boîte mails admin (étape 4 avant
 * activation du cron). Trois modes :
 *
 *   npx tsx scripts/inbound-imap-test.ts connect
 *     → teste la connexion IMAP + compte les mails de l'INBOX (aucune écriture).
 *
 *   npx tsx scripts/inbound-imap-test.ts dry-run [N]
 *     → récupère les N derniers mails (défaut 50), applique la blacklist + le
 *       tag, et rapporte ce qui SERAIT ingéré vs filtré (breakdown par domaine
 *       / tag). AUCUNE écriture DB, AUCUN contenu de mail affiché (juste
 *       domaines + tags + compteurs — respect vie privée).
 *
 *   npx tsx scripts/inbound-imap-test.ts poll
 *     → exécute le vrai pollInbound (insertion DB). Premier run = clean start
 *       (checkpoint calé sur uidNext-1, 0 ingéré : l'historique est ignoré).
 *
 * Lit .env.local. Lecture seule côté IMAP (jamais de modif de flags).
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const mode = process.argv[2] ?? "connect";
  const { ImapFlow } = await import("imapflow");
  const { getImapConfig, pollInbound } = await import(
    "@/lib/admin/inbound/imap-fetch"
  );

  const config = getImapConfig();
  if (!config) {
    console.error("✗ Identifiants IMAP manquants (IMAP_HOST/USER/PASSWORD).");
    process.exit(1);
  }
  console.log(
    `IMAP ${config.host}:${config.port} user=${config.user} (mode=${mode})`,
  );

  if (mode === "poll") {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const results = await pollInbound(createSupabaseAdminClient());
    console.log("Résultat pollInbound :", JSON.stringify(results, null, 2));
    process.exit(0);
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port === 993,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  await client.connect();
  console.log("✓ Connexion IMAP réussie.");
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  try {
    const mb = client.mailbox;
    const exists = mb && typeof mb !== "boolean" ? mb.exists : 0;
    const uidNext = mb && typeof mb !== "boolean" ? mb.uidNext : 0;
    console.log(`✓ INBOX : ${exists} mails, uidNext=${uidNext}`);

    if (mode === "dry-run") {
      const n = Number(process.argv[3] ?? "50");
      const start = Math.max(1, Number(uidNext) - n);
      const { simpleParser } = await import("mailparser");
      const { isIgnoredSender } = await import(
        "@/lib/admin/inbound/ignored-senders"
      );
      const { resolveInboundTag } = await import("@/lib/admin/inbound/tag");
      const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
      const admin = createSupabaseAdminClient();

      let total = 0;
      let ingest = 0;
      const filteredByDomain: Record<string, number> = {};
      const ingestByTag: Record<string, number> = {};

      for await (const msg of client.fetch(
        `${start}:*`,
        { uid: true, source: true },
        { uid: true },
      )) {
        if (!msg.source) continue;
        total += 1;
        const parsed = await simpleParser(msg.source as Buffer);
        const from = (parsed.from?.value?.[0]?.address ?? "").toLowerCase();
        const domain = from.includes("@") ? from.split("@")[1] : "(invalide)";
        if (!from || isIgnoredSender(from)) {
          filteredByDomain[domain] = (filteredByDomain[domain] ?? 0) + 1;
          continue;
        }
        const { tag } = await resolveInboundTag(admin, from);
        ingest += 1;
        ingestByTag[tag] = (ingestByTag[tag] ?? 0) + 1;
      }

      console.log(`\n--- DRY-RUN (${total} mails scannés, ${n} derniers) ---`);
      console.log(`SERAIENT ingérés : ${ingest}`);
      console.log("  par tag :", ingestByTag);
      console.log(`FILTRÉS (bruit) : ${total - ingest}`);
      console.log("  par domaine :", filteredByDomain);
    }
  } finally {
    lock.release();
  }
  await client.logout();
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Échec :", (err as Error).message);
  process.exit(1);
});

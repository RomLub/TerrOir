import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImapFlow } from "imapflow";

// Tests pollAccount (chantier 9) : clean start (checkpoint), fetch + parse +
// upsert + avance du checkpoint. Client IMAP injecté, parser + tag mockés.

vi.mock("mailparser", () => ({
  // simpleParser reçoit msg.source ; on renvoie l'objet tel quel (les fixtures
  // portent déjà la forme parsée).
  simpleParser: async (s: unknown) => s,
}));
vi.mock("@/lib/admin/inbound/tag", () => ({
  resolveInboundTag: async () => ({
    tag: "public",
    lookupUserId: null,
    lookupLeadId: null,
  }),
}));

import { pollAccount, type ImapConfig } from "@/lib/admin/inbound/imap-fetch";

const CONFIG: ImapConfig = { host: "h", port: 993, user: "contact@x.fr", pass: "p" };

function makeAdmin() {
  const upserts: Array<{ row: Record<string, unknown>; opts: unknown }> = [];
  const accountUpdates: Record<string, unknown>[] = [];
  const admin = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.update = (vals: Record<string, unknown>) => {
        if (table === "inbound_email_accounts") accountUpdates.push(vals);
        return { eq: () => Promise.resolve({ error: null }) };
      };
      b.upsert = (row: Record<string, unknown>, opts: unknown) => {
        upserts.push({ row, opts });
        return { select: () => Promise.resolve({ data: [{ id: "x" }], error: null }) };
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { admin, upserts, accountUpdates };
}

function fakeClientFactory(opts: {
  uidNext: number;
  uidValidity: number;
  messages: Array<{ uid: number; source: unknown }>;
}) {
  return () =>
    ({
      connect: async () => {},
      getMailboxLock: async () => ({ release: () => {} }),
      mailbox: { uidNext: opts.uidNext, uidValidity: opts.uidValidity },
      fetch: () =>
        (async function* () {
          for (const m of opts.messages) yield m;
        })(),
      logout: async () => {},
    }) as unknown as ImapFlow;
}

function msg(uid: number, address: string) {
  return {
    uid,
    source: {
      from: { value: [{ address, name: "X" }] },
      to: { text: "contact@x.fr" },
      subject: `Sujet ${uid}`,
      text: "Bonjour",
      html: false,
      messageId: `<m${uid}@x>`,
      inReplyTo: null,
      date: new Date("2026-05-24T10:00:00Z"),
    },
  };
}

const ACCOUNT = { id: "acc1", address: "contact@x.fr", last_seen_uid: 5, uid_validity: 100 };

beforeEach(() => vi.clearAllMocks());

describe("pollAccount", () => {
  it("clean start (last_seen_uid=0) → reset checkpoint sur uidNext-1, aucun fetch", async () => {
    const { admin, accountUpdates, upserts } = makeAdmin();
    const res = await pollAccount(
      admin,
      { ...ACCOUNT, last_seen_uid: 0, uid_validity: null },
      CONFIG,
      fakeClientFactory({ uidNext: 10, uidValidity: 100, messages: [msg(6, "a@x.fr")] }),
    );
    expect(res.reset).toBe(true);
    expect(res.fetched).toBe(0);
    expect(upserts).toHaveLength(0);
    expect(accountUpdates[0]).toMatchObject({ last_seen_uid: 9, uid_validity: 100 });
  });

  it("UIDVALIDITY changée → reset (pas de réimport massif)", async () => {
    const { admin, accountUpdates } = makeAdmin();
    const res = await pollAccount(
      admin,
      { ...ACCOUNT, uid_validity: 999 },
      CONFIG,
      fakeClientFactory({ uidNext: 20, uidValidity: 100, messages: [] }),
    );
    expect(res.reset).toBe(true);
    expect(accountUpdates[0]).toMatchObject({ last_seen_uid: 19, uid_validity: 100 });
  });

  it("fetch normal → upsert (dédup message_id) + checkpoint avancé", async () => {
    const { admin, upserts, accountUpdates } = makeAdmin();
    const res = await pollAccount(
      admin,
      ACCOUNT,
      CONFIG,
      fakeClientFactory({
        uidNext: 8,
        uidValidity: 100,
        messages: [msg(6, "a@x.fr"), msg(7, "b@x.fr")],
      }),
    );
    expect(res.error).toBeNull();
    expect(res.fetched).toBe(2);
    expect(res.inserted).toBe(2);
    expect(upserts).toHaveLength(2);
    // Déduplication par message_id (ignoreDuplicates).
    expect(upserts[0].opts).toMatchObject({ onConflict: "message_id", ignoreDuplicates: true });
    expect(upserts[0].row).toMatchObject({ message_id: "<m6@x>", from_email: "a@x.fr", tag: "public" });
    // Checkpoint avancé au max UID vu.
    expect(accountUpdates[0]).toMatchObject({ last_seen_uid: 7 });
  });

  it("pré-filtre bruit (stripe.com) : pas d'upsert mais checkpoint avancé", async () => {
    const { admin, upserts, accountUpdates } = makeAdmin();
    const res = await pollAccount(
      admin,
      ACCOUNT,
      CONFIG,
      fakeClientFactory({
        uidNext: 8,
        uidValidity: 100,
        messages: [msg(6, "real@gmail.com"), msg(7, "noreply@stripe.com")],
      }),
    );
    expect(res.fetched).toBe(2); // 2 mails vus
    expect(upserts).toHaveLength(1); // 1 seul inséré (stripe ignoré)
    expect(upserts[0].row).toMatchObject({ from_email: "real@gmail.com" });
    // Checkpoint avancé malgré l'ignoré (on ne le re-traitera pas).
    expect(accountUpdates[0]).toMatchObject({ last_seen_uid: 7 });
  });
});

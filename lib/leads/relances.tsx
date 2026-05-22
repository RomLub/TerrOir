import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatePrefillToken } from "@/lib/leads/prefill-token";
import { generateOptOutToken } from "@/lib/rgpd/opt-out-token";
import { sendTemplate } from "@/lib/resend/send";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";
import LeadRelance1, {
  subject as r1Subject,
} from "@/lib/resend/templates/lead-relance-1";
import LeadRelance2, {
  subject as r2Subject,
} from "@/lib/resend/templates/lead-relance-2";
import LeadRelance3, {
  subject as r3Subject,
} from "@/lib/resend/templates/lead-relance-3";

// Chantier 3 — moteur des relances auto + abandon auto des leads spontanés.
// Logique métier isolée du route handler pour testabilité (cf. pattern
// lib/maintenance/sweep-e2e-residuals.ts consommé par le cron).
//
// Relances (lead spontané = source 'formulaire_public', non abandonné,
// current_step < 5) :
//   - R1 à J+3, R2 à J+10, R3 à J+20 (depuis created_at).
//   - Dedup par existence d'un followup automatique du palier (relance_step).
//   - On envoie au plus UN palier par run et par lead : le plus haut palier dû
//     non encore envoyé (évite un burst de 3 mails si le cron a été down).
//   - Le lien CTA est un prefill personnel : on réutilise le prefill_token du
//     lead s'il est encore valide, sinon on en génère un (persisté) — ainsi
//     tous les liens de relance restent valides.
//   - Envoi → followup is_automatic + bump current_step (R1→2, R2→3, R3→4,
//     advance-only) + audit producer_interest_auto_relance_sent.
//
// Abandon auto (J+40) : lead spontané non abandonné, créé il y a ≥ 40j, dont
// l'email n'a jamais signé (auth.users.last_sign_in_at IS NULL ou pas de
// compte) ET sans demande de publication (producers.publication_requested_at
// IS NULL ou pas de producer) → abandoned_at = now, reason =
// 'no_sign_in_after_3_relances', audit producer_interest_abandoned_auto.
//
// Idempotent : re-run = no-op (followup palier déjà posé → pas de renvoi ;
// abandoned_at posé → exclu de la sélection).

const DAY_MS = 24 * 60 * 60 * 1000;
const RELANCE_THRESHOLD_DAYS: Record<1 | 2 | 3, number> = { 1: 3, 2: 10, 3: 20 };
const ABANDON_THRESHOLD_DAYS = 40;
const ABANDON_REASON = "no_sign_in_after_3_relances";

type RelanceStep = 1 | 2 | 3;

type EligibleLead = {
  id: string;
  prenom: string | null;
  email: string;
  created_at: string;
  current_step: number;
  prefill_token: string | null;
  prefill_token_expires_at: string | null;
};

const RELANCE_TEMPLATES: Record<
  RelanceStep,
  {
    template: string;
    subject: () => string;
    render: (p: {
      ctaUrl: string;
      unsubscribeUrl: string;
      prenom: string | null;
    }) => React.ReactElement;
  }
> = {
  1: {
    template: "lead_relance_1",
    subject: r1Subject,
    render: (p) => <LeadRelance1 {...p} />,
  },
  2: {
    template: "lead_relance_2",
    subject: r2Subject,
    render: (p) => <LeadRelance2 {...p} />,
  },
  3: {
    template: "lead_relance_3",
    subject: r3Subject,
    render: (p) => <LeadRelance3 {...p} />,
  },
};

export type LeadsFollowupsResult = {
  relancesSent: number;
  abandoned: number;
  errors: string[];
};

function ageDays(createdAtIso: string, nowMs: number): number {
  return (nowMs - new Date(createdAtIso).getTime()) / DAY_MS;
}

// Palier le plus haut dû (age ≥ seuil) ET non encore envoyé.
function dueRelanceStep(
  lead: EligibleLead,
  sent: Set<number>,
  nowMs: number,
): RelanceStep | null {
  const age = ageDays(lead.created_at, nowMs);
  for (const step of [3, 2, 1] as RelanceStep[]) {
    if (age >= RELANCE_THRESHOLD_DAYS[step] && !sent.has(step)) return step;
  }
  return null;
}

async function ensurePrefillUrl(
  admin: SupabaseClient,
  lead: EligibleLead,
  nowMs: number,
): Promise<string> {
  const validStored =
    lead.prefill_token &&
    lead.prefill_token_expires_at &&
    new Date(lead.prefill_token_expires_at).getTime() > nowMs;
  let token = lead.prefill_token ?? "";
  if (!validStored) {
    const generated = generatePrefillToken(lead.id, nowMs);
    token = generated.token;
    await admin
      .from("producer_interests")
      .update({
        prefill_token: token,
        prefill_token_expires_at: generated.expiresAt.toISOString(),
      })
      .eq("id", lead.id);
  }
  return `${NEXT_PUBLIC_APP_URL}/devenir-producteur?prefill=${token}`;
}

async function processRelances(
  admin: SupabaseClient,
  nowMs: number,
  result: LeadsFollowupsResult,
): Promise<void> {
  const { data: leads, error } = await admin
    .from("producer_interests")
    .select(
      "id, prenom, email, created_at, current_step, prefill_token, prefill_token_expires_at",
    )
    .eq("source", "formulaire_public")
    .is("abandoned_at", null)
    .lt("current_step", 5);
  if (error) {
    result.errors.push(`relances_fetch: ${error.message}`);
    return;
  }
  const eligible = (leads ?? []) as unknown as EligibleLead[];
  if (eligible.length === 0) return;

  // followups auto déjà posés (dedup par palier).
  const { data: followups } = await admin
    .from("producer_interest_followups")
    .select("lead_id, relance_step")
    .eq("is_automatic", true)
    .in(
      "lead_id",
      eligible.map((l) => l.id),
    );
  const sentByLead = new Map<string, Set<number>>();
  for (const f of (followups ?? []) as { lead_id: string; relance_step: number | null }[]) {
    if (f.relance_step == null) continue;
    const set = sentByLead.get(f.lead_id) ?? new Set<number>();
    set.add(f.relance_step);
    sentByLead.set(f.lead_id, set);
  }

  for (const lead of eligible) {
    const step = dueRelanceStep(
      lead,
      sentByLead.get(lead.id) ?? new Set(),
      nowMs,
    );
    if (!step) continue;

    try {
      const ctaUrl = await ensurePrefillUrl(admin, lead, nowMs);
      const { token: optOut } = generateOptOutToken(lead.email);
      const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/desabonnement?email=${encodeURIComponent(
        lead.email,
      )}&token=${optOut}`;
      const tpl = RELANCE_TEMPLATES[step];

      const send = await sendTemplate({
        to: lead.email,
        userId: null,
        template: tpl.template,
        subject: tpl.subject(),
        element: tpl.render({ ctaUrl, unsubscribeUrl, prenom: lead.prenom }),
        metadata: { lead_id: lead.id, relance_step: step },
      });

      // On pose le followup si l'envoi a réussi OU a été supprimé (opt-out) :
      // dans les deux cas inutile de réessayer ce palier. Un échec technique
      // (render/5xx) ne pose pas de followup → retry au prochain run.
      if (!send.ok && !send.skipped) {
        result.errors.push(`relance_send lead=${lead.id} step=${step}`);
        continue;
      }

      await admin.from("producer_interest_followups").insert({
        lead_id: lead.id,
        channel: "email",
        direction: "outbound",
        is_automatic: true,
        relance_step: step,
        note: `Relance auto R${step}`,
      });

      // Avance la frise spontané (R1→2, R2→3, R3→4), advance-only.
      const nextStep = Math.max(lead.current_step, step + 1);
      if (nextStep !== lead.current_step) {
        await admin
          .from("producer_interests")
          .update({ current_step: nextStep, last_contact_at: new Date(nowMs).toISOString() })
          .eq("id", lead.id);
      } else {
        await admin
          .from("producer_interests")
          .update({ last_contact_at: new Date(nowMs).toISOString() })
          .eq("id", lead.id);
      }

      if (send.ok) {
        await logProducerInterestsEvent({
          eventType: "producer_interest_auto_relance_sent",
          userId: null,
          metadata: { interest_id: lead.id, email: lead.email, relance_step: step },
        });
        result.relancesSent += 1;
      }
    } catch (err) {
      result.errors.push(
        `relance lead=${lead.id} step=${step} error=${(err as Error).message}`,
      );
    }
  }
}

async function processAbandons(
  admin: SupabaseClient,
  nowMs: number,
  result: LeadsFollowupsResult,
): Promise<void> {
  const cutoffIso = new Date(nowMs - ABANDON_THRESHOLD_DAYS * DAY_MS).toISOString();
  const { data: leads, error } = await admin
    .from("producer_interests")
    .select("id, email, created_at")
    .eq("source", "formulaire_public")
    .is("abandoned_at", null)
    .lte("created_at", cutoffIso);
  if (error) {
    result.errors.push(`abandon_fetch: ${error.message}`);
    return;
  }
  const candidates = (leads ?? []) as { id: string; email: string; created_at: string }[];
  if (candidates.length === 0) return;

  const emails = candidates.map((c) => c.email.toLowerCase());

  // auth.users (PostgREST ne traverse pas auth.* en jointure → fetch direct).
  const { data: authRows } = await admin
    .schema("auth")
    .from("users")
    .select("id, email, last_sign_in_at")
    .in("email", emails);
  const authByEmail = new Map<string, { id: string; last_sign_in_at: string | null }>();
  for (const a of (authRows ?? []) as {
    id: string;
    email: string;
    last_sign_in_at: string | null;
  }[]) {
    authByEmail.set((a.email ?? "").toLowerCase(), {
      id: a.id,
      last_sign_in_at: a.last_sign_in_at,
    });
  }

  const userIds = [...authByEmail.values()].map((a) => a.id);
  const pubByUser = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: producers } = await admin
      .from("producers")
      .select("user_id, publication_requested_at")
      .in("user_id", userIds);
    for (const p of (producers ?? []) as {
      user_id: string;
      publication_requested_at: string | null;
    }[]) {
      pubByUser.set(p.user_id, p.publication_requested_at);
    }
  }

  for (const lead of candidates) {
    const auth = authByEmail.get(lead.email.toLowerCase());
    const signedIn = auth?.last_sign_in_at != null;
    const requestedPub = auth ? pubByUser.get(auth.id) != null : false;
    if (signedIn || requestedPub) continue; // engagé → on ne touche pas

    try {
      await admin
        .from("producer_interests")
        .update({
          abandoned_at: new Date(nowMs).toISOString(),
          abandoned_reason: ABANDON_REASON,
        })
        .eq("id", lead.id);
      await logProducerInterestsEvent({
        eventType: "producer_interest_abandoned_auto",
        userId: null,
        metadata: { interest_id: lead.id, email: lead.email, reason: ABANDON_REASON },
      });
      result.abandoned += 1;
    } catch (err) {
      result.errors.push(
        `abandon lead=${lead.id} error=${(err as Error).message}`,
      );
    }
  }
}

export async function runLeadsFollowups(
  admin: SupabaseClient,
  opts: { nowMs?: number } = {},
): Promise<LeadsFollowupsResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const result: LeadsFollowupsResult = {
    relancesSent: 0,
    abandoned: 0,
    errors: [],
  };
  await processRelances(admin, nowMs, result);
  await processAbandons(admin, nowMs, result);
  return result;
}

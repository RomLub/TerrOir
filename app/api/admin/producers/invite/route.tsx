import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { escapeIlikeEmail } from "@/lib/supabase/escape-ilike";
import { sendTemplate } from "@/lib/resend/send";
import { generateOptOutToken } from "@/lib/rgpd/opt-out-token";
import { maskEmail } from "@/lib/rgpd/mask-email";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";
import { logAdminInviteEvent } from "@/lib/audit-logs/log-admin-invite-event";
import { dbErrorResponse } from "@/lib/api/db-error-response";
import {
  consumeRateLimit,
  getAdminInviteRateLimit,
} from "@/lib/rate-limit";
import ProducerInvitation, {
  subject as invitationSubject,
} from "@/lib/resend/templates/producer-invitation";
import {
  NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_PRODUCER_URL,
} from "@/lib/env/urls";

const bodySchema = z.object({
  email: z.string().trim().email(),
  prenom: z.string().trim().optional(),
  nom: z.string().trim().optional(),
  telephone: z.string().trim().optional(),
  nom_exploitation: z.string().trim().optional(),
  commune: z.string().trim().optional(),
  especes: z.array(z.string()).optional(),
  message: z.string().trim().optional(),
  // Flag UX : second POST envoyé par le modal admin après confirmation
  // explicite de l'opérateur quand l'email correspond à un onboarding
  // producer abandonné (producer.statut='draft'). Voir handler ci-dessous.
  confirm_draft_resend: z.boolean().optional(),
});

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // sec-P2-3 (T9 2026-05-07) : rate-limit applicatif Upstash 10/min/admin
  // (keying par session.id). Defense in depth pour absorber un admin
  // compromis ou un bot scriptant le form admin. Couplé au audit log
  // logAdminInviteEvent existant (forensique). Fail-open si Upstash absent
  // (cohérent pattern lib/rate-limit.ts).
  const rl = await consumeRateLimit(
    getAdminInviteRateLimit(),
    `admin:${session.id}`,
  );
  if (!rl.success) {
    const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
    console.warn(
      `[ADMIN_INVITE_RATE_LIMITED] admin=${session.id} cap=${rl.limit} retry_after=${retryAfter}`,
    );
    return NextResponse.json(
      { error: "rate_limited", retry_after: retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const admin = createSupabaseAdminClient();

  // 1. Pré-checks : refuser admin et producteur déjà inscrit
  const { data: existingAdmin, error: adminCheckError } = await admin
    .from("admin_users")
    .select("id")
    .ilike("email", escapeIlikeEmail(input.email))
    .maybeSingle();
  if (adminCheckError) {
    return dbErrorResponse(adminCheckError, "ADMIN_INVITE_ADMIN_CHECK", {
      admin_id: session.id,
    });
  }
  if (existingAdmin) {
    // T-081 — audit log forensique : un admin a tenté d'inviter un email
    // qui correspond déjà à un compte administrateur. userId = admin
    // tentant l'invitation (session.id), invitation_email en clair pour
    // permettre l'investigation (l'admin a saisi l'email volontairement,
    // pas une donnée user-side).
    await logAdminInviteEvent(session.id, {
      type: "admin_invite_blocked_admin",
      invitation_email: input.email,
    });
    // T-105 : `kind` ajouté pour permettre à l'UI admin de différencier les
    // 409 (admin / producer / draft_resend) sans regex sur le message texte.
    // `error` (legacy) reste fourni pour compat consumers tiers / logs.
    return NextResponse.json(
      {
        error: "Impossible d'inviter un administrateur comme producteur",
        kind: "blocked_admin",
      },
      { status: 409 },
    );
  }

  const { data: existingUser, error: userCheckError } = await admin
    .from("users")
    .select("id, roles")
    .ilike("email", escapeIlikeEmail(input.email))
    .maybeSingle();
  if (userCheckError) {
    return dbErrorResponse(userCheckError, "ADMIN_INVITE_USER_CHECK", {
      admin_id: session.id,
    });
  }
  // Si users.roles contient 'producer', on regarde producer.statut pour
  // distinguer :
  //   - statut='draft' : onboarding abandonné, l'admin peut relancer (les
  //     autres surfaces — page /invitation et loginAndUpgradeAction —
  //     gèrent déjà la reprise de manière idempotente). Friction UX
  //     volontaire : le 1er POST renvoie 409 kind='draft_resend_confirm_required'
  //     pour que le modal affiche un encadré informatif + bouton dédié,
  //     et le 2nd POST avec `confirm_draft_resend=true` autorise la
  //     génération d'un nouveau token. Les anciens tokens encore actifs
  //     pour ce même email sont auto-revoqués par le bloc T-109 ci-dessous
  //     (UPDATE expires_at=now()) avant l'INSERT du nouveau, garantissant
  //     qu'un seul lien valide existe à un instant donné — pas d'orphelin
  //     exploitable côté user.
  //   - autres statuts ('pending'|'active'|'public'|'suspended'|'deleted')
  //     : 409 dur, inchangé.
  let isDraftResend = false;
  if (
    existingUser &&
    Array.isArray(existingUser.roles) &&
    existingUser.roles.includes("producer")
  ) {
    const { data: existingProducer, error: producerCheckError } = await admin
      .from("producers")
      .select("statut")
      .eq("user_id", existingUser.id)
      .maybeSingle();
    if (producerCheckError) {
      return NextResponse.json(
        { error: producerCheckError.message },
        { status: 500 },
      );
    }
    if (existingProducer?.statut !== "draft") {
      // T-081 — audit log forensique : un admin a tenté d'inviter un email
      // qui correspond déjà à un producteur inscrit (statut hors 'draft').
      // Distinct de admin_invite_blocked_admin (cluster admin_users) — celui-ci
      // cible la table users + producers. metadata.statut permet de distinguer
      // les variantes (pending/active/public/suspended/deleted) sans nouveau
      // event_type (sémantique stable côté query, granularité côté metadata).
      // Le 409 'draft_resend_confirm_required' n'émet PAS d'event : ce n'est
      // pas un blocage strict, juste une demande de confirmation UX.
      await logAdminInviteEvent(session.id, {
        type: "admin_invite_blocked_producer",
        invitation_email: input.email,
        statut: existingProducer?.statut ?? null,
      });
      // T-105 : `kind` + `statut` exposés à l'UI pour message contextuel
      // (suspendu, supprimé, actif…). Pas de leak — l'admin a déjà saisi
      // l'email volontairement, et la sémantique est nécessaire à la
      // décision UX (ex: producer suspended ≠ producer actif).
      return NextResponse.json(
        {
          error: "Ce producteur est déjà inscrit",
          kind: "blocked_producer",
          statut: existingProducer?.statut ?? null,
        },
        { status: 409 },
      );
    }
    if (!input.confirm_draft_resend) {
      return NextResponse.json(
        {
          error:
            "Cet email correspond à un onboarding producteur abandonné. Confirmez la relance pour envoyer une nouvelle invitation.",
          kind: "draft_resend_confirm_required",
        },
        { status: 409 },
      );
    }
    isDraftResend = true;
  }

  // Détection compte consumer pré-existant : le user va pouvoir se logger
  // avec ses creds existants et loginAndUpgradeAction ajoutera le rôle
  // 'producer' à l'acceptation. On expose le flag à l'UI admin pour
  // afficher un toast info distinct (l'admin a la confirmation visuelle
  // que le flow upgrade-rôles va se déclencher, pas une création
  // de compte from scratch). Note : un draft_resend a roles=['consumer','producer']
  // → existing_account=null (le compte est déjà producer côté roles).
  const existingAccount: "consumer" | null =
    existingUser &&
    Array.isArray(existingUser.roles) &&
    existingUser.roles.includes("consumer") &&
    !existingUser.roles.includes("producer")
      ? "consumer"
      : null;

  // T-109 — Invalidation auto des invitations actives matchant cet email.
  // Avant d'émettre un nouveau token, on bumpe expires_at=now() sur toutes
  // les invitations encore valides (used_at IS NULL AND expires_at > now())
  // pour le même email, en match case-insensitive (ilike, cohérent T-110 et
  // producer_interests). Évite la pollution de tokens orphelins multiples
  // côté DB et empêche un user de claim un vieux lien après une relance.
  //
  // Gardé fail-open : si le UPDATE échoue, on log warn et on continue
  // l'INSERT du nouveau token. La data state DB peut alors avoir 2 tokens
  // valides simultanément — pas de corruption, juste de la dette nettoyable
  // par le cron de purge ou la consommation `used_at`.
  //
  // Race condition couverte par un trigger DB AFTER INSERT
  // `trg_invalidate_active_invitations` (migration 20260506143923, T-109) qui
  // re-bumpe expires_at=now() sur les invitations actives matchant NEW.email.
  // Le bloc applicatif ci-dessous reste source des audit_logs `invitation_revoked`
  // (1 event par row revoquée, voir bloc L243+) — le trigger est un filet
  // atomique pour les POST concurrents (admin humain, peu probable, mais le
  // double-clic du modal et un éventuel script automatisé sont couverts).
  //
  // Ordre critique : ce bloc DOIT s'exécuter AVANT l'INSERT du nouveau
  // token, sinon on bumperait aussi le nouveau (ilike + used_at null +
  // expires_at > now() matcherait la row qu'on vient de créer).
  const nowIso = new Date().toISOString();
  const { data: revokedInvitations, error: revokeError } = await admin
    .from("producer_invitations")
    .update({ expires_at: nowIso })
    .ilike("email", escapeIlikeEmail(input.email))
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("id");
  if (revokeError) {
    console.warn(
      `[INVITATION_REVOKE_WARN] Failed to revoke active invitations for ${maskEmail(input.email)}: ${revokeError.message}`,
    );
  }

  // 2. Préparer TOUS les tokens AVANT le moindre write DB. Si un token
  //    échoue (OPT_OUT_TOKEN_SECRET absent → generateOptOutToken throw),
  //    on 500 proprement sans laisser d'invitation orpheline en base.
  const token = randomBytes(32).toString("hex");

  // Lien opt-out RGPD embarqué dans le pied de l'email (token HMAC signé
  // avec TTL 30j, pointe sur www). F-027 : la signature retourne
  // maintenant { token, expiresAt } — on n'utilise que `token` ici, le
  // recipient verra l'expiration côté page /desabonnement.
  const { token: optOutToken } = generateOptOutToken(input.email);
  const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/desabonnement?email=${encodeURIComponent(
    input.email,
  )}&token=${optOutToken}`;

  // 3. Invitation (token + expiry gérés par la table)
  const { data: invitation, error: invitationError } = await admin
    .from("producer_invitations")
    .insert({
      email: input.email,
      token,
      created_by: session.id,
    })
    .select("id, token, expires_at")
    .single();
  if (invitationError || !invitation) {
    return NextResponse.json(
      { error: invitationError?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  // T-310 : audit log forensique cluster invitation. Émis dès l'INSERT OK
  // (avant l'envoi email) pour ne pas perdre l'event si l'email échoue —
  // l'invitation existe bien en base, l'admin l'a bien créée. userId =
  // admin créateur (pas l'invité, qui n'a pas encore de compte). Token
  // jamais loggé en clair : prefix 8 chars suffit pour cross-référencer
  // avec le warn race_lost côté complete-onboarding.
  await logAuthEvent({
    eventType: "invitation_created",
    userId: session.id,
    metadata: {
      invitation_id: invitation.id,
      invitation_email: input.email,
      token_prefix: token.slice(0, 8),
    },
  });

  // T-109 — audit log forensique pour les invitations revoquées par le bloc
  // ci-dessus. 1 event par row (cohérent T-310 : 1 event = 1 entité), avec
  // lien vers le nouveau token (replaced_by_invitation_id) pour reconstituer
  // la chaîne d'invitations sur un même email lors d'une analyse forensique.
  // Émis APRÈS invitation_created : on a besoin de invitation.id pour
  // remplir replaced_by_invitation_id. Si l'INSERT précédent a échoué (500),
  // ce bloc n'est pas atteint — la data DB a vu son revoke (les anciens
  // tokens sont morts) sans event audit, console.warn ci-dessus tracé.
  if (revokedInvitations && revokedInvitations.length > 0) {
    for (const revoked of revokedInvitations as Array<{ id: string }>) {
      await logAuthEvent({
        eventType: "invitation_revoked",
        userId: session.id,
        metadata: {
          revoked_invitation_id: revoked.id,
          replaced_by_invitation_id: invitation.id,
          email: maskEmail(input.email),
        },
      });
    }
  }

  const invitationUrl = `${NEXT_PUBLIC_PRODUCER_URL}/invitation?token=${invitation.token}`;

  // 4. Email via Resend. Wrap dans try/catch pour absorber tout throw
  //    imprévu (sendTemplate ne devrait pas throw, mais ceinture+bretelles).
  //    Le gating emailResult.ok plus bas suffit alors à skip le bump lead.
  let emailResult: { ok: true; id: string } | { ok: false; error: string };
  try {
    emailResult = await sendTemplate({
      to: input.email,
      userId: null,
      template: "producer_invitation",
      subject: invitationSubject(),
      element: (
        // eslint-disable-next-line react-hooks/error-boundaries -- false positive : ce JSX n'est pas rendu par React DOM, il est passé à sendTemplate qui le rend en string HTML via @react-email/render. Le try/catch externe absorbe les throws inattendus de sendTemplate (ceinture+bretelles, cf. commentaire au-dessus).
        <ProducerInvitation
          invitationUrl={invitationUrl}
          unsubscribeUrl={unsubscribeUrl}
        />
      ),
      // token_prefix retiré (T-322) : leak forensique inutile vers Resend.
      // Le token_prefix reste tracé côté audit_logs Supabase via logAuthEvent
      // (event 'invitation_created', metadata.token_prefix) — système interne.
      metadata: { email: input.email },
    });
  } catch (err) {
    const message = (err as Error).message;
    console.error(
      `[EMAIL_SEND_FAIL] template=producer_invitation to=${maskEmail(input.email)} error_name=unexpected_throw error_message=${message}`,
    );
    emailResult = { ok: false, error: message };
  }

  // T-081 — audit log forensique "transport email". Émis APRÈS sendTemplate
  // succès (gating emailResult.ok). Distinct de invitation_created (déjà
  // émis L210, marque l'INSERT DB) : invitation_created peut être émis sans
  // que l'email soit parti (cf. test H3) — ce bloc est l'event "email
  // effectivement envoyé".
  //
  // Mutuellement exclusifs : admin_invite_draft_resend si isDraftResend
  // (relance d'un onboarding producer abandonné, statut='draft'), sinon
  // admin_invite_sent (envoi initial — lead direct, consumer existant ou
  // prospect). Permet aux queries forensiques de distinguer les 2 patterns
  // de funnel acquisition (initial vs reactivation).
  if (emailResult.ok) {
    await logAdminInviteEvent(session.id, {
      type: isDraftResend ? "admin_invite_draft_resend" : "admin_invite_sent",
      invitation_id: invitation.id,
      invitation_email: input.email,
      resend_id: emailResult.id,
    });
  }

  // 5. Bump du lead matching : producer_interests.statut 'new' → 'contacted'.
  //    Gaté sur emailResult.ok : si l'email n'est pas parti, le prospect n'a
  //    pas vraiment été "contacté", on laisse le lead en 'new' pour relance.
  //    Match email case-insensitive (ilike sans wildcards). Si 0 rows
  //    (admin invite un prospect direct, jamais passé par /devenir-producteur),
  //    no-op silencieux — on ne bloque pas l'invitation déjà partie.
  let leadUpdated = 0;
  if (emailResult.ok) {
    const { data: bumped, error: bumpError } = await admin
      .from("producer_interests")
      .update({ statut: "contacted" })
      .ilike("email", escapeIlikeEmail(input.email))
      .eq("statut", "new")
      .select("id");
    if (bumpError) {
      console.warn(
        `[LEAD_BUMP_WARN] Failed to bump producer_interests for ${maskEmail(input.email)}: ${bumpError.message}`,
      );
    } else {
      leadUpdated = bumped?.length ?? 0;
    }
  }

  // 6. Création d'un lead invitation_directe (chantier vision funnel, Phase 1).
  //    Si l'email n'a matché aucun lead 'new' au bump ci-dessus ET qu'aucun
  //    lead n'existe pour cet email tous statuts confondus, c'est que l'admin
  //    invite un prospect direct (jamais passé par /devenir-producteur). On
  //    crée alors le lead a posteriori avec source='invitation_directe' et
  //    statut='contacted' (skip 'new' : il a déjà été contacté par
  //    l'invitation qui vient de partir) pour que l'onglet Leads soit le
  //    journal d'acquisition complet.
  //
  //    Fail-open : si la création échoue (réseau, RLS, contrainte), log
  //    [LEAD_CREATE_WARN] et on ne bloque pas l'invitation déjà partie.
  //    `nom` est NOT NULL en base : fallback sur la partie locale de l'email
  //    quand l'admin n'a pas saisi de nom (champ optionnel côté UI).
  let leadCreated = false;
  if (emailResult.ok && leadUpdated === 0) {
    const { data: existingLead, error: existingLeadError } = await admin
      .from("producer_interests")
      .select("id")
      .ilike("email", escapeIlikeEmail(input.email))
      .maybeSingle();
    if (existingLeadError) {
      console.warn(
        `[LEAD_CREATE_WARN] Failed to check existing lead for ${maskEmail(input.email)}: ${existingLeadError.message}`,
      );
    } else if (!existingLead) {
      const fallbackNom = input.nom?.trim() || input.email.split("@")[0];
      const { error: insertError } = await admin
        .from("producer_interests")
        .insert({
          email: input.email,
          prenom: input.prenom ?? null,
          nom: fallbackNom,
          telephone: input.telephone ?? null,
          nom_exploitation: input.nom_exploitation ?? null,
          commune: input.commune ?? null,
          especes: input.especes ?? null,
          message: input.message ?? null,
          statut: "contacted",
          source: "invitation_directe",
        });
      if (insertError) {
        console.warn(
          `[LEAD_CREATE_WARN] Failed to create invitation_directe lead for ${maskEmail(input.email)}: ${insertError.message}`,
        );
      } else {
        leadCreated = true;
      }
    }
  }

  return NextResponse.json({
    url: invitationUrl,
    expires_at: invitation.expires_at,
    email_sent: emailResult.ok,
    email_error: emailResult.ok ? undefined : emailResult.error,
    lead_updated: leadUpdated,
    lead_created: leadCreated,
    draft_resend: isDraftResend,
    existing_account: existingAccount,
  });
}

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import { generateOptOutToken } from "@/lib/rgpd/opt-out-token";
import { maskEmail } from "@/lib/rgpd/mask-email";
import ProducerInvitation, {
  subject as invitationSubject,
} from "@/lib/resend/templates/producer-invitation";
import {
  NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_PRODUCER_URL,
} from "@/lib/env/urls";

const bodySchema = z.object({
  email: z.string().trim().email(),
  nom: z.string().trim().optional(),
  telephone: z.string().trim().optional(),
  nom_exploitation: z.string().trim().optional(),
  commune: z.string().trim().optional(),
  especes: z.array(z.string()).optional(),
  message: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session || !session.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    .eq("email", input.email)
    .maybeSingle();
  if (adminCheckError) {
    return NextResponse.json({ error: adminCheckError.message }, { status: 500 });
  }
  if (existingAdmin) {
    return NextResponse.json(
      { error: "Impossible d'inviter un administrateur comme producteur" },
      { status: 409 },
    );
  }

  const { data: existingUser, error: userCheckError } = await admin
    .from("users")
    .select("id, roles")
    .eq("email", input.email)
    .maybeSingle();
  if (userCheckError) {
    return NextResponse.json({ error: userCheckError.message }, { status: 500 });
  }
  if (
    existingUser &&
    Array.isArray(existingUser.roles) &&
    existingUser.roles.includes("producer")
  ) {
    return NextResponse.json(
      { error: "Ce producteur est déjà inscrit" },
      { status: 409 },
    );
  }

  // 2. Préparer TOUS les tokens AVANT le moindre write DB. Si un token
  //    échoue (OPT_OUT_TOKEN_SECRET absent → generateOptOutToken throw),
  //    on 500 proprement sans laisser d'invitation orpheline en base.
  const token = randomBytes(32).toString("hex");

  // Lien opt-out RGPD embarqué dans le pied de l'email (token HMAC
  // déterministe, pointe sur www).
  const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/desabonnement?email=${encodeURIComponent(
    input.email,
  )}&token=${generateOptOutToken(input.email)}`;

  // 3. Invitation (token + expiry gérés par la table)
  const { data: invitation, error: invitationError } = await admin
    .from("producer_invitations")
    .insert({
      email: input.email,
      token,
      created_by: session.id,
    })
    .select("token, expires_at")
    .single();
  if (invitationError || !invitation) {
    return NextResponse.json(
      { error: invitationError?.message ?? "Insert failed" },
      { status: 500 },
    );
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
        <ProducerInvitation
          invitationUrl={invitationUrl}
          unsubscribeUrl={unsubscribeUrl}
        />
      ),
      metadata: { token_prefix: token.slice(0, 8), email: input.email },
    });
  } catch (err) {
    const message = (err as Error).message;
    console.error(
      `[EMAIL_SEND_FAIL] template=producer_invitation to=${maskEmail(input.email)} error_name=unexpected_throw error_message=${message}`,
    );
    emailResult = { ok: false, error: message };
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
      .ilike("email", input.email)
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
      .ilike("email", input.email)
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
  });
}

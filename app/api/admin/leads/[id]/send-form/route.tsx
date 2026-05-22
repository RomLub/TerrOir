import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProducerInterest } from "@/lib/admin/producer-interests/fetch";
import {
  setLeadPrefillTokenAndAdvance,
  logLeadFollowup,
} from "@/lib/admin/producer-interests/mutations";
import { logProducerInterestsEvent } from "@/lib/audit-logs/log-producer-interests-event";
import { generatePrefillToken } from "@/lib/leads/prefill-token";
import { generateOptOutToken } from "@/lib/rgpd/opt-out-token";
import { sendTemplate } from "@/lib/resend/send";
import LeadFormInvitation, {
  subject as formInvitationSubject,
} from "@/lib/resend/templates/lead-form-invitation";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// POST /api/admin/leads/[id]/send-form — envoie au prospect son formulaire
// pré-rempli. Génère un prefill_token HMAC, envoie l'email depuis no-reply@,
// persiste le token + avance le lead à l'étape 3 (formulaire envoyé), et
// journalise l'interaction. Audit producer_interest_form_sent.
//
// Ordre : on envoie l'email AVANT de persister le token/step, pour ne pas
// laisser un lead en étape 3 si l'envoi échoue. Le token est valide dès sa
// génération (HMAC self-contained) ; sa persistance (juste après succès) sert
// la vérification de révocation côté /devenir-producteur.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, props: RouteContext) {
  const { id } = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const before = await getProducerInterest(admin, id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { token, expiresAt } = generatePrefillToken(id);
  const ctaUrl = `${NEXT_PUBLIC_APP_URL}/devenir-producteur?prefill=${token}`;
  const { token: optOutToken } = generateOptOutToken(before.email);
  const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/desabonnement?email=${encodeURIComponent(
    before.email,
  )}&token=${optOutToken}`;

  const sendResult = await sendTemplate({
    to: before.email,
    userId: null,
    template: "lead_form_invitation",
    subject: formInvitationSubject(),
    element: (
      <LeadFormInvitation
        ctaUrl={ctaUrl}
        unsubscribeUrl={unsubscribeUrl}
        prenom={before.prenom}
      />
    ),
    metadata: { lead_id: id },
  });

  if (!sendResult.ok) {
    const status = sendResult.skipped ? 409 : 502;
    return NextResponse.json(
      { error: sendResult.skipped ? "email_suppressed" : "email_send_failed" },
      { status },
    );
  }

  // Email parti : on persiste le token + avance à l'étape 3.
  const persist = await setLeadPrefillTokenAndAdvance(
    admin,
    id,
    token,
    expiresAt.toISOString(),
  );
  if (!persist.ok) {
    return NextResponse.json({ error: "Internal database error" }, { status: 500 });
  }

  // L'envoi du formulaire compte comme une interaction sortante.
  await logLeadFollowup(admin, {
    leadId: id,
    channel: "email",
    direction: "outbound",
    note: "Formulaire d'inscription envoyé",
    createdBy: session.id,
    isAutomatic: false,
  });

  await logProducerInterestsEvent({
    eventType: "producer_interest_form_sent",
    userId: session.id,
    metadata: {
      interest_id: id,
      email: before.email,
      expires_at: expiresAt.toISOString(),
    },
  });

  return NextResponse.json({ id, sent: true });
}

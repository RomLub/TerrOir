import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTemplate } from "@/lib/resend/send";
import { generateOptOutToken } from "@/lib/rgpd/opt-out-token";
import ProducerInvitation, {
  subject as invitationSubject,
} from "@/lib/resend/templates/producer-invitation";

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

  // 2. Invitation (token + expiry gérés par la table)
  const token = randomBytes(32).toString("hex");
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

  const producerBase =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://pro.localhost:3000";
  const invitationUrl = `${producerBase}/invitation?token=${invitation.token}`;

  // Lien opt-out RGPD embarqué dans le pied de l'email (token HMAC
  // déterministe, pointe sur www. Impose que OPT_OUT_TOKEN_SECRET soit
  // configuré côté Vercel — sinon generateOptOutToken throw et casse l'envoi.
  const publicBase =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const unsubscribeUrl = `${publicBase}/desabonnement?email=${encodeURIComponent(
    input.email,
  )}&token=${generateOptOutToken(input.email)}`;

  // 3. Email via Resend
  const emailResult = await sendTemplate({
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

  // 4. Trace dans producer_interests avec statut='contacted'
  const { error: interestError } = await admin
    .from("producer_interests")
    .insert({
      nom: input.nom ?? input.email,
      email: input.email,
      telephone: input.telephone ?? null,
      nom_exploitation: input.nom_exploitation ?? null,
      commune: input.commune ?? null,
      especes: input.especes ?? null,
      message: input.message ?? null,
      statut: "contacted",
    });

  return NextResponse.json({
    url: invitationUrl,
    expires_at: invitation.expires_at,
    email_sent: emailResult.ok,
    email_error: emailResult.ok ? undefined : emailResult.error,
    interest_logged: !interestError,
    interest_error: interestError?.message,
  });
}

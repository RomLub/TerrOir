import { NextResponse } from "next/server";
import { z } from "zod";
import { resend, resendFromEmail } from "@/lib/resend/client";
import { renderEmail } from "@/lib/resend/send";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  consumeRateLimit,
  getContactFormRateLimit,
} from "@/lib/rate-limit";
import { extractRequestContext } from "@/lib/audit-logs/log-auth-event";
import { maskEmail } from "@/lib/rgpd/mask-email";
import { maskIp } from "@/lib/rgpd/mask-ip";
import ContactFormSubmission, {
  subject as contactSubject,
  type Props as ContactProps,
} from "@/lib/resend/templates/contact-form-submission";

// POST /api/contact — soumission du formulaire public /contact (page P0
// légales 2026-05-06).
//
// Sécurité (defense in depth) :
//   1. Validation Zod stricte (sujet enum, message ≥ 20, consent literal(true))
//   2. Honeypot "website" : si rempli → 200 silencieux sans envoi (les bots
//      qui remplissent tous les inputs sont avalés sans signaler le piège)
//   3. Rate-limit applicatif Upstash 3/h/IP (cap bas, form public coûteux)
//   4. Pas de session requise (POST anonyme)
//
// Email :
//   - Destinataire interne : contact@terroir-local.fr (mailbox Zimbra OVH)
//   - From : RESEND_FROM_EMAIL (no-reply@terroir-local.fr)
//   - Reply-To : email du visiteur (clic "Répondre" répond au visiteur)
//   - Pas de passage par sendTemplate() (helper destiné aux emails sortants
//     vers users — suppression list + notifications insert non pertinents
//     pour un email interne équipe)
//
// Audit log : event_type='contact_form_submitted' inséré best-effort dans
// public.audit_logs (table append-only, schema accepte tout text en
// event_type, pas de migration nécessaire). Échec audit ne bloque pas la
// réponse OK au visiteur.

const SUJET_VALUES = [
  "question",
  "commande",
  "producteur",
  "presse",
  "autre",
] as const;

const SUJET_LABELS: Record<(typeof SUJET_VALUES)[number], string> = {
  question: "Question générale",
  commande: "Question sur ma commande",
  producteur: "Devenir producteur",
  presse: "Presse / partenariat",
  autre: "Autre",
};

const bodySchema = z.object({
  sujet: z.enum(SUJET_VALUES),
  nom: z.string().trim().min(1, "Nom requis").max(120),
  email: z.string().trim().toLowerCase().email("Email invalide"),
  telephone: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  message: z
    .string()
    .trim()
    .min(20, "Le message doit contenir au moins 20 caractères")
    .max(5000),
  consent: z.literal(true, {
    error: "Le consentement RGPD est requis",
  }),
  // Honeypot : champ texte facultatif. La présence d'une valeur est traitée
  // comme un signal bot — la requête est faussement validée 200 sans envoi.
  website: z.string().optional(),
});

const CONTACT_TO = "contact@terroir-local.fr";

export async function POST(request: Request) {
  const { ipAddress, userAgent } = extractRequestContext(request.headers);

  const parsed = bodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Données invalides",
      },
      { status: 400 },
    );
  }

  const input = parsed.data;

  // Honeypot : faux 200 silencieux (le bot ne ré-essaie pas, on n'expose
  // pas la présence du piège). Pas d'envoi email, pas d'audit log — le
  // bruit serait pollutif vu le volume attendu de bots scrapant le form.
  if (input.website && input.website.trim().length > 0) {
    console.warn(
      `[CONTACT_HONEYPOT_HIT] ip=${ipAddress ?? "(none)"} ua=${userAgent ? userAgent.slice(0, 80) : "(none)"}`,
    );
    return NextResponse.json({ ok: true });
  }

  // Rate-limit IP (3/h). Fail-open si Upstash absent (cf. lib/rate-limit.ts).
  const rateIdentifier = ipAddress ?? "anon-no-ip";
  const limiter = getContactFormRateLimit();
  const rateResult = await consumeRateLimit(limiter, rateIdentifier);
  if (!rateResult.success) {
    console.warn(
      `[CONTACT_RATE_LIMIT] ip=${rateIdentifier} email=${maskEmail(input.email)}`,
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          "Vous avez envoyé plusieurs messages récemment. Merci de réessayer dans une heure.",
      },
      { status: 429 },
    );
  }

  const submittedAt = new Date().toISOString();
  const sujetLabel = SUJET_LABELS[input.sujet];

  // Envoi email équipe (Resend direct — pas de sendTemplate, cf. note en
  // tête de fichier).
  const emailProps: ContactProps = {
    sujet: input.sujet,
    sujetLabel,
    nom: input.nom,
    email: input.email,
    telephone: input.telephone ?? null,
    message: input.message,
    submittedAt,
    ipAddress,
  };

  let html: string;
  try {
    // eslint-disable-next-line react-hooks/error-boundaries -- false positive : ce JSX n'est pas rendu par React DOM, il est rendu en string HTML par renderEmail (Resend SDK via @react-email/render) qui est async. Le try/catch capture bien la promise rejection.
    html = await renderEmail(<ContactFormSubmission {...emailProps} />);
  } catch (err) {
    console.error(
      `[CONTACT_RENDER_FAIL] email=${maskEmail(input.email)} error=${(err as Error).message}`,
    );
    return NextResponse.json(
      { ok: false, error: "Erreur serveur lors de la préparation du message" },
      { status: 500 },
    );
  }

  try {
    const { data, error } = await resend.emails.send({
      from: resendFromEmail,
      to: CONTACT_TO,
      replyTo: input.email,
      subject: contactSubject(emailProps),
      html,
    });
    if (error || !data) {
      console.error(
        `[CONTACT_SEND_FAIL] email=${maskEmail(input.email)} resend_error=${error?.message ?? "unknown"}`,
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            "Impossible d'envoyer le message pour le moment. Merci de réessayer dans quelques minutes.",
        },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error(
      `[CONTACT_SEND_THROW] email=${maskEmail(input.email)} error=${(err as Error).message}`,
    );
    return NextResponse.json(
      {
        ok: false,
        error: "Impossible d'envoyer le message pour le moment.",
      },
      { status: 502 },
    );
  }

  // Audit log best-effort : ne bloque pas la réponse OK si la table audit_logs
  // est down ou si l'INSERT plante. Le mail est déjà parti, le contact est
  // enregistré côté Resend (logs Resend dashboard).
  //
  // sec-P2-2 (T9 2026-05-07) : pas de PII en clair dans cet audit_logs.
  // Avant : email + nom + IP brute en clair (déviation doctrine T-200 r1).
  // Après : maskEmail (ju***@dom), nom retiré du metadata (pas de masking
  // standard FR sans risque de mishandle accents), maskIp (/24). Le destinataire
  // de l'email reçoit déjà nom + email en clair via Resend (legitime), donc
  // pas de perte fonctionnelle. La trace forensique reste utile (sujet,
  // longueur message, presence telephone, /24 IP pour grouper attaques).
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      user_id: null,
      event_type: "contact_form_submitted",
      metadata: {
        sujet: input.sujet,
        email_masked: maskEmail(input.email),
        has_nom: input.nom.length > 0,
        has_telephone: input.telephone != null,
        message_length: input.message.length,
      },
      ip_address: maskIp(ipAddress),
      user_agent: userAgent,
    });
  } catch (err) {
    console.warn(
      `[CONTACT_AUDIT_WRITE_WARN] email=${maskEmail(input.email)} error=${(err as Error).message}`,
    );
  }

  return NextResponse.json({ ok: true });
}

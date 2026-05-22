"use server";

import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { producerSignupSchema } from "@/lib/auth/validators";
import { slugFromEmail } from "@/lib/producers/slug-from-email";
import { LEGAL_VERSIONS } from "@/lib/legal/versions";
import { consumeRateLimit, getProducerSignupRateLimit } from "@/lib/rate-limit";
import {
  extractRequestContext,
  logAuthEvent,
} from "@/lib/audit-logs/log-auth-event";
import { verifyPrefillToken } from "@/lib/leads/prefill-token";
import { upsertProducerInterest } from "@/lib/producer-interests/upsert-interest";
import { generateOptOutToken } from "@/lib/rgpd/opt-out-token";
import { sendTemplate } from "@/lib/resend/send";
import ProducerWelcome, {
  subject as welcomeSubject,
} from "@/lib/resend/templates/producer-welcome";
import { NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";
import { maskEmail } from "@/lib/rgpd/mask-email";

// Chantier 3 Phase 2bis — création de compte producteur self-service depuis
// /devenir-producteur (www). Squelette repris de createAccountAction (flux
// invitation) : auth.users (email_confirm:true → accès immédiat) + public.users
// (rôles consumer+producer) + producers draft + rollback orphelin. Le cookie
// de session est posé sur `.terroir-local.fr` (partagé www↔pro, cf.
// lib/supabase/cookie-domain.ts) → le producteur est connecté sur son espace
// pro sans re-login.
//
// Convergence prospect : si prefillToken valide, on rattache la soumission au
// lead existant (étape 4 « formulaire complété »), email verrouillé sur celui
// du lead. Sinon lead spontané (upsert par email).

export type ProducerSignupState = {
  error?: string;
  // accountExists → la page affiche le lien vers /connexion (décision Romain :
  // message clair assumé, oracle d'énumération accepté en B2B faible volume).
  accountExists?: boolean;
  success?: boolean;
  // URL de l'espace producteur — la page y navigue côté client (le cookie
  // partagé authentifie sur pro).
  redirectTo?: string;
};

const SPACE_URL = `${NEXT_PUBLIC_PRODUCER_URL}/ma-page`;

export async function signupProducerAction(
  _prev: ProducerSignupState,
  formData: FormData,
): Promise<ProducerSignupState> {
  const especes = formData
    .getAll("especes")
    .map((v) => String(v).trim())
    .filter(Boolean);

  const parsed = producerSignupSchema.safeParse({
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    email: formData.get("email"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
    telephone: formData.get("telephone"),
    nom_exploitation: formData.get("nom_exploitation"),
    commune: formData.get("commune"),
    code_postal: formData.get("code_postal"),
    especes: especes.length > 0 ? especes : undefined,
    message: formData.get("message") ?? "",
    prefillToken: formData.get("prefillToken") ?? "",
    cgu_accepted: formData.get("cgu_accepted") ?? false,
    website: formData.get("website") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }
  const d = parsed.data;

  // Honeypot anti-bot : champ caché rempli → on simule un succès neutre sans
  // rien créer (pas de redirect, pas de signal au bot).
  if (d.website && d.website.trim() !== "") {
    return { success: true };
  }

  // Rate-limit IP : 10 / heure (décision Romain).
  const { ipAddress } = extractRequestContext(await headers());
  const rl = await consumeRateLimit(
    getProducerSignupRateLimit(),
    ipAddress ?? "unknown",
  );
  if (!rl.success) {
    await logAuthEvent({
      eventType: "rate_limit_exceeded",
      userId: null,
      metadata: { route: "producer_signup", cap: rl.limit, reset: rl.reset },
    });
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  }

  const admin = createSupabaseAdminClient();

  // Convergence prospect : valider le lien + verrouiller l'email sur le lead.
  let leadId: string | null = null;
  let email = d.email;
  if (d.prefillToken) {
    const v = verifyPrefillToken(d.prefillToken);
    if (v.valid) {
      const { data: lead } = await admin
        .from("producer_interests")
        .select("id, email, prefill_token")
        .eq("id", v.leadId)
        .maybeSingle();
      // Le token doit correspondre à la valeur stockée (révocation : un
      // nouveau lien envoyé invalide l'ancien même si son HMAC tient).
      if (lead && lead.prefill_token === d.prefillToken) {
        leadId = lead.id as string;
        email = lead.email as string; // email autoritaire = celui du lead
      }
    }
    // Token invalide/révoqué → on retombe en signup spontané avec l'email saisi.
  }

  // Création du compte (sert aussi de check d'existence : createUser échoue si
  // l'email existe déjà).
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: d.password,
      email_confirm: true,
    });
  if (createError || !created.user) {
    const code = (createError as { code?: string } | undefined)?.code;
    if (
      code === "email_exists" ||
      (createError?.message && /already (registered|exists)/i.test(createError.message))
    ) {
      return {
        error:
          "Un compte existe déjà pour cette adresse. Connectez-vous d'abord pour ajouter une activité producteur.",
        accountExists: true,
      };
    }
    console.error(
      `PRODUCER_SIGNUP_CREATE_USER_ERR email=${maskEmail(email)} code=${code ?? "n/a"} msg=${createError?.message ?? "n/a"}`,
    );
    return { error: "Création du compte impossible. Réessayez plus tard." };
  }
  const userId = created.user.id;

  // Profil public.users (service_role : pas de session active à l'INSERT).
  const { error: profileError } = await admin.from("users").insert({
    id: userId,
    email,
    roles: ["consumer", "producer"],
    prenom: d.prenom,
    nom: d.nom,
    telephone: d.telephone,
    cgu_accepted_at: new Date().toISOString(),
    cgu_version: LEGAL_VERSIONS.CGU,
  });
  if (profileError) {
    const { error: rb } = await admin.auth.admin.deleteUser(userId);
    if (rb) {
      console.error(
        `PRODUCER_SIGNUP_ORPHAN_AUTH user_id=${userId} email=${maskEmail(email)} profile_error=${profileError.message} rollback_error=${rb.message}`,
      );
    }
    return { error: "Création du compte impossible. Réessayez plus tard." };
  }

  // Producteur en draft.
  const { error: producerError } = await admin.from("producers").insert({
    user_id: userId,
    slug: slugFromEmail(email),
    nom_exploitation: d.nom_exploitation,
    statut: "draft",
    commune: d.commune,
    code_postal: d.code_postal,
  });
  if (producerError) {
    const { error: rb } = await admin.auth.admin.deleteUser(userId);
    if (rb) {
      console.error(
        `PRODUCER_SIGNUP_ORPHAN_AUTH_AFTER_PROFILE user_id=${userId} email=${maskEmail(email)} producer_error=${producerError.message} rollback_error=${rb.message}`,
      );
    }
    return { error: "Création du compte impossible. Réessayez plus tard." };
  }

  // Lead : prospect → update du lead existant (étape 4) ; spontané → upsert.
  if (leadId) {
    await admin
      .from("producer_interests")
      .update({
        current_step: 4,
        statut: "contacted",
        prenom: d.prenom,
        nom: d.nom,
        telephone: d.telephone,
        nom_exploitation: d.nom_exploitation,
        commune: d.commune,
        message: d.message ?? null,
      })
      .eq("id", leadId);
  } else {
    await upsertProducerInterest(admin, {
      prenom: d.prenom,
      nom: d.nom,
      email,
      telephone: d.telephone,
      nom_exploitation: d.nom_exploitation,
      commune: d.commune,
      message: d.message ?? null,
    });
  }

  // Connexion (pose le cookie partagé .terroir-local.fr → accès pro immédiat).
  const supabase = await createSupabaseServerClient();
  const { error: signinError } = await supabase.auth.signInWithPassword({
    email,
    password: d.password,
  });
  if (signinError) {
    return {
      error:
        "Compte créé mais connexion automatique échouée. Connectez-vous depuis l'écran de connexion.",
    };
  }

  // Email de bienvenue (fail-safe : un échec d'envoi ne casse pas le signup).
  try {
    const { token: optOut } = generateOptOutToken(email);
    const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/desabonnement?email=${encodeURIComponent(
      email,
    )}&token=${optOut}`;
    await sendTemplate({
      to: email,
      userId,
      template: "producer_welcome",
      subject: welcomeSubject(),
      element: (
        <ProducerWelcome
          spaceUrl={SPACE_URL}
          unsubscribeUrl={unsubscribeUrl}
          prenom={d.prenom}
        />
      ),
      metadata: { producer_signup: true, prospect: Boolean(leadId) },
    });
  } catch (err) {
    console.error(
      `PRODUCER_SIGNUP_WELCOME_EMAIL_ERR email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  await logAuthEvent({
    eventType: "account_signup",
    userId,
    metadata: { via: "devenir_producteur", prospect: Boolean(leadId) },
  });

  return { success: true, redirectTo: SPACE_URL };
}

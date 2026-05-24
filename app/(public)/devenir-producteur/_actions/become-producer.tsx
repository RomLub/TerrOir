"use server";

import { cookies, headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { becomeProducerSchema } from "@/lib/auth/validators";
import { slugFromEmail } from "@/lib/producers/slug-from-email";
import { consumeRateLimit, getProducerSignupRateLimit } from "@/lib/rate-limit";
import {
  extractRequestContext,
  logAuthEvent,
} from "@/lib/audit-logs/log-auth-event";
import { upsertProducerInterest } from "@/lib/producer-interests/upsert-interest";
import { clearRoleSnapshotOnStore } from "@/lib/auth/role-snapshot-cookie";
import { generateOptOutToken } from "@/lib/rgpd/opt-out-token";
import { sendTemplate } from "@/lib/resend/send";
import ProducerWelcome, {
  subject as welcomeSubject,
} from "@/lib/resend/templates/producer-welcome";
import { NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";
import { maskEmail } from "@/lib/rgpd/mask-email";
import type { ProducerSignupState } from "./signup-producer";

// « Devenir producteur » pour un utilisateur DÉJÀ CONNECTÉ (consommateur).
// Contrairement à signupProducerAction, on NE crée PAS de compte : on rattache
// l'activité producteur au compte existant.
//
// SÉCURITÉ : l'id ET l'email viennent de la session (jamais du client). Admin
// exclu. Idempotent si déjà producteur. Après ajout du rôle, on vide le cookie
// de snapshot de rôle pour que le middleware relise les rôles à jour (sinon il
// rejetterait l'accès à l'espace pro avec un snapshot périmé).

const SPACE_URL = `${NEXT_PUBLIC_PRODUCER_URL}/ma-page`;

export async function becomeProducerAction(
  _prev: ProducerSignupState,
  formData: FormData,
): Promise<ProducerSignupState> {
  const session = await getSessionUser();
  if (!session) return { error: "Vous devez être connecté." };
  if (session.isAdmin) {
    return { error: "Action non disponible pour un compte administrateur." };
  }
  const email = session.email;
  if (!email) return { error: "Email du compte introuvable." };

  const especes = formData
    .getAll("especes")
    .map((v) => String(v).trim())
    .filter(Boolean);

  const parsed = becomeProducerSchema.safeParse({
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    telephone: formData.get("telephone"),
    nom_exploitation: formData.get("nom_exploitation"),
    commune: formData.get("commune"),
    code_postal: formData.get("code_postal"),
    especes: especes.length > 0 ? especes : undefined,
    message: formData.get("message") ?? "",
    cgu_accepted: formData.get("cgu_accepted") ?? false,
    website: formData.get("website") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }
  const d = parsed.data;

  // Honeypot : succès neutre, rien créé.
  if (d.website && d.website.trim() !== "") {
    return { success: true, redirectTo: SPACE_URL };
  }

  const hdrs = await headers();
  const { ipAddress } = extractRequestContext(hdrs);
  const rl = await consumeRateLimit(
    getProducerSignupRateLimit(),
    ipAddress ?? "unknown",
  );
  if (!rl.success) {
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  }

  const admin = createSupabaseAdminClient();

  // Idempotence : déjà producteur (fiche existante ou rôle) → vers l'espace.
  const { data: existingProducer } = await admin
    .from("producers")
    .select("id")
    .eq("user_id", session.id)
    .maybeSingle();
  if (existingProducer || session.roles.includes("producer")) {
    return { success: true, redirectTo: SPACE_URL };
  }

  // 1. Rattache le rôle producteur au compte existant + met à jour le contact.
  const nextRoles = Array.from(
    new Set([...session.roles, "consumer", "producer"]),
  );
  const { error: roleError } = await admin
    .from("users")
    .update({
      roles: nextRoles,
      prenom: d.prenom,
      nom: d.nom,
      telephone: d.telephone,
    })
    .eq("id", session.id);
  if (roleError) {
    console.error(
      `BECOME_PRODUCER_ROLE_ERR user=${session.id} error=${roleError.message}`,
    );
    return {
      error: "Impossible d'ajouter l'activité producteur. Réessayez plus tard.",
    };
  }

  // 2. Fiche producteur en draft.
  const { error: producerError } = await admin.from("producers").insert({
    user_id: session.id,
    slug: slugFromEmail(email),
    nom_exploitation: d.nom_exploitation,
    statut: "draft",
    commune: d.commune,
    code_postal: d.code_postal,
  });
  if (producerError) {
    // Compensation : on retire le rôle producteur qu'on vient d'ajouter (le
    // compte consommateur reste intact). Pas de compte fantôme.
    await admin
      .from("users")
      .update({ roles: session.roles })
      .eq("id", session.id);
    console.error(
      `BECOME_PRODUCER_DRAFT_ERR user=${session.id} error=${producerError.message}`,
    );
    return { error: "Impossible de créer votre espace. Réessayez plus tard." };
  }

  // 3. Vide le snapshot de rôle (cookie) → le middleware relit les rôles frais
  //    et ne rejette pas l'accès à l'espace pro après la redirection.
  try {
    clearRoleSnapshotOnStore(await cookies(), hdrs.get("host"));
  } catch (e) {
    console.warn(
      `BECOME_PRODUCER_SNAPSHOT_CLEAR_WARN user=${session.id} error=${(e as Error).message}`,
    );
  }

  // 4. Lead (funnel) — best-effort.
  try {
    await upsertProducerInterest(admin, {
      prenom: d.prenom,
      nom: d.nom,
      email,
      telephone: d.telephone,
      nom_exploitation: d.nom_exploitation,
      commune: d.commune,
      message: d.message ?? null,
    });
  } catch (e) {
    console.warn(
      `BECOME_PRODUCER_LEAD_WARN user=${session.id} error=${(e as Error).message}`,
    );
  }

  // 5. Email de bienvenue (fail-safe).
  try {
    const { token: optOut } = generateOptOutToken(email);
    const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/desabonnement?email=${encodeURIComponent(
      email,
    )}&token=${optOut}`;
    await sendTemplate({
      to: email,
      userId: session.id,
      template: "producer_welcome",
      subject: welcomeSubject(),
      element: (
        <ProducerWelcome
          spaceUrl={SPACE_URL}
          unsubscribeUrl={unsubscribeUrl}
          prenom={d.prenom}
        />
      ),
      metadata: { become_producer: true },
    });
  } catch (err) {
    console.error(
      `BECOME_PRODUCER_WELCOME_EMAIL_ERR email=${maskEmail(email)} error=${(err as Error).message}`,
    );
  }

  await logAuthEvent({
    eventType: "account_signup",
    userId: session.id,
    metadata: { via: "become_producer_logged_in" },
  });

  return { success: true, redirectTo: SPACE_URL };
}

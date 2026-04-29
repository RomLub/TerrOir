"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/app/connexion/actions";

// Étape 1 du flow reset password : l'user saisit son email, Supabase envoie
// un email avec un lien custom (template Supabase Reset Password) pointant
// directement vers /reinitialiser-mot-de-passe?token_hash=…&type=recovery
// (étape 2 — formulaire nouveau mot de passe).
//
// Server action requestPasswordResetAction : redirectTo figé côté serveur
// via getPasswordResetUrl(isAdmin) — URLs hardcodées (cf. lib/auth/email-redirect.ts)
// pour bloquer toute host header injection (T-317). Lookup admin via la
// table admin_users (même pattern que magic link) pour préserver l'isolation
// Chantier 4 : un admin demandant reset revient sur admin.*/reinitialiser-mot-de-passe
// et garde son cookie admin isolé. Audit log écrit côté serveur pour
// conformité (cf. lib/audit-logs/log-auth-event.ts).
//
// Enumeration-resistance : Supabase resetPasswordForEmail retourne success
// même pour un email inexistant — on affiche toujours le même message
// ambigu quelle que soit la réponse, pour ne pas révéler l'existence d'un
// compte.

export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !email.includes("@")) return;
    setSubmitting(true);

    const formData = new FormData();
    formData.append("email", email.trim());
    await requestPasswordResetAction({}, formData);

    setSent(true);
    setSubmitting(false);
  };

  if (sent) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-terroir-green">
            Vérifiez vos emails
          </h1>
          <p className="text-sm text-terroir-ink">
            Si cette adresse est connue, un email de réinitialisation vient
            d&apos;être envoyé. Pensez à consulter vos spams.
          </p>
          <Link
            href="/connexion"
            className="inline-block text-sm text-terroir-green underline hover:opacity-80"
          >
            Retour à la connexion
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-bold text-terroir-green">
          Mot de passe oublié
        </h1>
        <p className="text-sm text-terroir-muted">
          Saisissez votre email, nous vous enverrons un lien pour définir un
          nouveau mot de passe.
        </p>

        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <button
          type="submit"
          disabled={submitting || !email.includes("@")}
          className="w-full rounded-md bg-terroir-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terroir-green/90 disabled:opacity-60"
        >
          {submitting ? "Envoi…" : "Envoyer le lien"}
        </button>

        <Link
          href="/connexion"
          className="block text-center text-sm text-terroir-muted underline hover:text-terroir-green"
        >
          Retour à la connexion
        </Link>
      </form>
    </main>
  );
}

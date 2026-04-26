"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Étape 1 du flow reset password : l'user saisit son email, Supabase envoie
// un email avec un lien custom (template Supabase Reset Password) pointant
// directement vers /reinitialiser-mot-de-passe?token_hash=…&type=recovery
// (étape 2 — formulaire nouveau mot de passe).
//
// `redirectTo` dynamique basé sur window.location.origin : un admin qui
// demande reset depuis admin.* revient sur admin.*/reinitialiser-mot-de-passe
// et garde son cookie admin isolé (Chantier 4). Même logique pour www et pro.
// Cette valeur est exposée à Supabase comme `{{ .RedirectTo }}` dans le
// template — utilisée par le template custom pour composer le lien final.
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

    const supabase = createSupabaseBrowserClient();
    // Le template Supabase Reset Password est configuré pour pointer
    // directement vers /reinitialiser-mot-de-passe avec ?token_hash=…&type=recovery,
    // ce qui force l'user à passer par le formulaire de nouveau mot de passe
    // avant tout login automatique. Cette URL est aussi exposée comme
    // `{{ .RedirectTo }}` dans le template — elle sert de base host-aware
    // (admin.* / pro.* / www.*) pour composer le lien final.
    const redirectTo = `${window.location.origin}/reinitialiser-mot-de-passe`;
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });

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

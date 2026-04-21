"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function PasswordPage() {
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      if (!data.user) {
        setError("Vous devez être connecté.");
      } else {
        setEmail(data.user.email ?? "");
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!email) {
      setError("Session introuvable. Reconnectez-vous.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Le nouveau mot de passe doit être différent de l'actuel.");
      return;
    }

    setSubmitting(true);
    const supabase = createSupabaseBrowserClient();

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (signInError) {
      setSubmitting(false);
      setError("Mot de passe actuel incorrect.");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  return (
    <main className="mx-auto max-w-2xl">
      <header className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-terra-700">
            Mon compte
          </p>
          <h1 className="mt-2 font-serif text-[40px] leading-tight text-terroir-green-700">
            Mot de passe
          </h1>
          <p className="mt-2 text-sm text-terroir-muted">
            Changez votre mot de passe. Minimum 8 caractères.
          </p>
        </header>

        {loading ? (
          <p className="text-sm text-terroir-muted">Chargement…</p>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border border-terroir-border bg-white p-6 shadow-sm"
            noValidate
          >
            {email ? (
              <input
                type="hidden"
                name="username"
                autoComplete="username"
                value={email}
                readOnly
              />
            ) : null}

            <Input
              name="currentPassword"
              type="password"
              label="Mot de passe actuel"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />

            <Input
              name="newPassword"
              type="password"
              label="Nouveau mot de passe"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />

            <Input
              name="confirmPassword"
              type="password"
              label="Confirmer le nouveau mot de passe"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />

            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-4 pt-2">
              {success ? (
                <span className="text-sm text-terroir-green-700" role="status">
                  Mot de passe modifié.
                </span>
              ) : null}
              <Button type="submit" size="lg" disabled={submitting}>
                {submitting ? "Enregistrement…" : "Modifier"}
              </Button>
            </div>
          </form>
        )}
    </main>
  );
}

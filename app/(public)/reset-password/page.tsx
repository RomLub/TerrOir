'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button, Input } from '@/components/ui';

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-terroir-muted">Chargement…</div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSessionExpired(false);

    if (password.length < 8) {
      setError('Minimum 8 caractères.');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setSubmitting(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      const isExpired = /session|expired|missing|invalid/i.test(
        updateError.message,
      );
      setSessionExpired(isExpired);
      setError(
        isExpired
          ? 'Lien de réinitialisation expiré ou invalide. Redemandez un nouvel email.'
          : updateError.message,
      );
      return;
    }

    router.replace('/connexion?reset=success');
  };

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-terroir-border bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="font-serif text-2xl text-terroir-ink">
            Nouveau mot de passe
          </h1>
          <p className="mt-1 text-sm text-terroir-muted">
            Choisissez un mot de passe d&apos;au moins 8 caractères.
          </p>
        </div>

        <Input
          label="Nouveau mot de passe"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <Input
          label="Confirmer"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
            {sessionExpired ? (
              <div className="mt-2">
                <Link href="/connexion" className="underline">
                  Retour à la connexion
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </form>
    </main>
  );
}

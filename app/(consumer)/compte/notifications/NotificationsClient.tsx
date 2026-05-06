'use client';

import { useState } from 'react';
import type {
  NotificationPreferenceKey,
  UserNotificationPreferences,
} from '@/lib/notifications/preferences';

// Liste des prefs exposées dans l'UI. Structure prévue pour extension :
// ajouter une nouvelle pref = ajouter une row dans PREFS + ajouter une
// colonne boolean dans la migration + l'exposer dans
// UserNotificationPreferences.
const PREFS: Array<{
  key: NotificationPreferenceKey;
  label: string;
  description: string;
}> = [
  {
    key: 'email_review_response',
    label: "Réponse d'un producteur à mon avis",
    description:
      'Recevoir un email quand un producteur publie une réponse à un avis que vous avez laissé.',
  },
];

export function NotificationsClient({
  initialPrefs,
}: {
  initialPrefs: UserNotificationPreferences;
}) {
  const [prefs, setPrefs] = useState<UserNotificationPreferences>(initialPrefs);
  const [busyKey, setBusyKey] = useState<NotificationPreferenceKey | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (key: NotificationPreferenceKey) => {
    const previous = prefs[key];
    const next = !previous;
    setPrefs((p) => ({ ...p, [key]: next }));
    setBusyKey(key);
    setFeedback(null);
    setError(null);

    try {
      const res = await fetch('/api/consumer/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: next }),
      });
      if (!res.ok) {
        // Rollback optimistic.
        setPrefs((p) => ({ ...p, [key]: previous }));
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Mise à jour impossible');
        return;
      }
      setFeedback('Préférence mise à jour');
      setTimeout(() => setFeedback(null), 3000);
    } catch {
      setPrefs((p) => ({ ...p, [key]: previous }));
      setError('Erreur de connexion');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <main className="mx-auto max-w-2xl">
      <header className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-terra-700">
          Mon compte
        </p>
        <h1 className="mt-1 font-serif text-[28px] text-gray-900">Notifications</h1>
        <p className="mt-2 text-[14px] text-gray-600">
          Choisissez quelles notifications email vous souhaitez recevoir. Les
          emails liés à vos commandes et à votre compte (sécurité,
          authentification) ne sont pas désactivables.
        </p>
      </header>

      <section className="rounded-md border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-200">
          {PREFS.map((pref) => (
            <li key={pref.key} className="flex items-start gap-4 p-5">
              <div className="flex-1">
                <div className="text-[15px] font-semibold text-gray-900">{pref.label}</div>
                <p className="mt-1 text-[13px] text-gray-600">{pref.description}</p>
              </div>
              <Toggle
                checked={prefs[pref.key]}
                onChange={() => toggle(pref.key)}
                disabled={busyKey === pref.key}
                aria-label={pref.label}
              />
            </li>
          ))}
        </ul>
      </section>

      {feedback && (
        <p className="mt-4 text-[13px] text-terroir-green-700" role="status">
          {feedback}
        </p>
      )}
      {error && (
        <p className="mt-4 text-[13px] text-red-700" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  ...rest
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-terroir-green-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-terroir-green-700' : 'bg-gray-300'
      }`}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

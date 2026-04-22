'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { unsubscribeAction } from './unsubscribe-action';

type State = { success: true } | { success: false; error: string } | null;

export function UnsubscribeForm({ email, token }: { email: string; token: string }) {
  const [state, formAction] = useFormState<State, FormData>(
    async (_prev, formData) => unsubscribeAction(formData),
    null,
  );

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-green-300/40 bg-green-100/60 p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-green-700 text-3xl">
          ✓
        </div>
        <h2 className="mt-4 font-serif text-[28px] text-green-900">
          C&apos;est fait.
        </h2>
        <p className="mt-2 text-[15px] text-dark/70">
          Vos coordonnées ont été supprimées. Vous ne recevrez plus de communication
          de la part de TerrOir.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="token" value={token} />

      <div className="rounded-xl border border-dark/10 bg-white p-4 text-[14px] text-dark/80">
        <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-1">
          Email concerné
        </div>
        <div className="mono text-[15px] text-green-900">{email}</div>
      </div>

      <p className="text-[14px] text-dark/70 leading-relaxed">
        En confirmant, vos coordonnées (nom, email, téléphone, exploitation) seront
        définitivement supprimées de notre base. Cette action est irréversible.
      </p>

      {state && !state.success && (
        <div className="rounded-xl border border-terra-300/40 bg-terra-100/60 p-3 text-[13px] text-terra-900">
          {state.error}
        </div>
      )}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Suppression en cours…' : 'Confirmer le désabonnement'}
    </Button>
  );
}

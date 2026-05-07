'use client';

import { useActionState } from "react";
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { requestNewOptOutLinkAction } from '../request-new-link-action';

type State =
  | { success: true; message: string }
  | { success: false; error: string }
  | null;

export function RequestLinkForm({ helperText }: { helperText?: string }) {
  const [state, formAction] = useActionState<State, FormData>(
    async (_prev, formData) => requestNewOptOutLinkAction(formData),
    null,
  );

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-green-300/40 bg-green-100/60 p-6">
        <h2 className="font-serif text-[22px] text-green-900">
          Demande reçue
        </h2>
        <p className="mt-2 text-[14px] text-dark/70 leading-relaxed">
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <h2 className="font-serif text-[22px] text-green-900">Se désabonner</h2>
        <p className="mt-2 text-[14px] text-dark/70 leading-relaxed">
          {helperText ??
            "Entrez l'email avec lequel vous avez été contacté. Nous vous enverrons le lien de désabonnement."}
        </p>
      </div>

      <label className="block">
        <span className="text-[13px] uppercase tracking-[0.14em] text-terra-700 font-semibold">
          Email
        </span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="mt-2 w-full rounded-xl border border-dark/10 bg-white px-4 py-3 text-[15px] text-green-900 focus:outline-none focus:ring-2 focus:ring-green-700/40 focus:border-green-700"
          placeholder="vous@exemple.fr"
        />
      </label>

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
      {pending ? 'Envoi…' : 'Recevoir le lien par email'}
    </Button>
  );
}

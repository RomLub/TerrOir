"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useUserContext } from "@/components/providers/user-provider";
import { PasswordInput } from "@/components/ui";
import {
  deleteAccountAction,
  type DeleteAccountState,
} from "../delete-account-action";

const CONFIRM_TEXT = "SUPPRIMER";
const INITIAL: DeleteAccountState = {};
// Note : le success path est désormais géré côté serveur via redirect()
// dans delete-account-action.ts (vers /?compte-supprime=1). state.success
// n'est plus jamais observé côté client en happy path. On le garde dans
// le type DeleteAccountState pour compat éventuelle mais sans l'exploiter
// dans la modale.

export default function DeleteAccountSection() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <section className="mt-12 rounded-2xl border border-red-200 bg-red-50/40 p-6">
      <h2 className="text-lg font-semibold text-red-700">Zone dangereuse</h2>
      <p className="mt-2 text-sm text-terroir-muted">
        La suppression de compte est irréversible. Elle efface tes données
        personnelles et respecte ton droit à l&apos;oubli (RGPD).
      </p>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
        >
          Supprimer mon compte
        </button>
      </div>

      {modalOpen ? (
        <DeleteModal onClose={() => setModalOpen(false)} />
      ) : null}
    </section>
  );
}

function DeleteModal({ onClose }: { onClose: () => void }) {
  const { roles, user } = useUserContext();
  const email = user?.email ?? "";
  const isProducer = roles.includes("producer");

  const [state, formAction] = useActionState(deleteAccountAction, INITIAL);
  const [confirmText, setConfirmText] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  // Autofocus password à l'ouverture
  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  // Escape ferme la modale
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-gray-200 bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-700">
          Irréversible
        </div>
        <h2
          id="delete-account-title"
          className="mt-1 font-serif text-[24px] leading-tight text-gray-900"
        >
          Supprimer définitivement ton compte
        </h2>

        <ul className="mt-4 list-disc space-y-1.5 rounded-md border border-red-200 bg-red-50/60 p-4 pl-8 text-[13px] leading-relaxed text-red-900">
          <li>Cette action est irréversible.</li>
          <li>Toutes tes données personnelles seront effacées.</li>
          <li>
            Tes commandes passées seront anonymisées (obligation comptable).
          </li>
          {isProducer ? (
            <li>
              Tes produits, créneaux et avis reçus seront supprimés. Ta fiche
              producteur sera anonymisée.
            </li>
          ) : null}
        </ul>

        <form action={formAction} className="mt-6 space-y-4" noValidate>
          <input
            type="hidden"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
          />

          <PasswordInput
            ref={passwordRef}
            id="delete-password"
            label="Mot de passe"
            name="password"
            autoComplete="current-password"
            required
          />

          <div className="flex flex-col gap-1">
            <label
              htmlFor="delete-confirm"
              className="text-sm font-medium text-terroir-ink"
            >
              Pour confirmer, tapez{" "}
              <span className="font-mono font-semibold text-red-700">
                {CONFIRM_TEXT}
              </span>
            </label>
            <input
              id="delete-confirm"
              type="text"
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full rounded-md border border-terroir-border bg-white px-3 py-2 text-sm text-terroir-ink focus:outline-none focus:ring-2 focus:ring-terroir-green-700 focus:border-terroir-green-700"
            />
          </div>

          {state.error ? (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              Annuler
            </button>
            <DeleteSubmitButton confirmText={confirmText} />
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteSubmitButton({ confirmText }: { confirmText: string }) {
  const { pending } = useFormStatus();
  const enabled = confirmText === CONFIRM_TEXT && !pending;
  return (
    <button
      type="submit"
      disabled={!enabled}
      className="rounded-md bg-red-600 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Suppression…" : "Supprimer définitivement mon compte"}
    </button>
  );
}

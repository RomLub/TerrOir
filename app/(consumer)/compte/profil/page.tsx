"use client";

import { useState, type FormEvent } from "react";
import { Button, Footer, Input, NavbarPublic } from "@/components/ui";

type Profil = {
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  smsOptIn: boolean;
};

const INITIAL: Profil = {
  prenom: "",
  nom: "",
  email: "",
  telephone: "",
  smsOptIn: false,
};

export default function ProfilPage() {
  const [profil, setProfil] = useState<Profil>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update =
    <K extends keyof Profil>(key: K) =>
    (value: Profil[K]) => {
      setProfil((p) => ({ ...p, [key]: value }));
      setSaved(false);
    };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-terroir-bg">
      <NavbarPublic isAuthenticated />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-terra-700">
            Mon compte
          </p>
          <h1 className="mt-2 font-serif text-[40px] leading-tight text-terroir-green-700">
            Mes informations
          </h1>
          <p className="mt-2 text-sm text-terroir-muted">
            Ces informations sont utilisées pour vos commandes et retraits chez
            les éleveurs.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-terroir-border bg-white p-6 shadow-sm"
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              name="prenom"
              label="Prénom"
              autoComplete="given-name"
              required
              value={profil.prenom}
              onChange={(e) => update("prenom")(e.target.value)}
            />
            <Input
              name="nom"
              label="Nom"
              autoComplete="family-name"
              required
              value={profil.nom}
              onChange={(e) => update("nom")(e.target.value)}
            />
          </div>

          <div className="mt-4">
            <Input
              name="email"
              type="email"
              label="Email"
              autoComplete="email"
              required
              value={profil.email}
              onChange={(e) => update("email")(e.target.value)}
            />
          </div>

          <div className="mt-4">
            <Input
              name="telephone"
              type="tel"
              label="Téléphone"
              autoComplete="tel"
              placeholder="06 12 34 56 78"
              value={profil.telephone}
              onChange={(e) => update("telephone")(e.target.value)}
              hint="Utilisé par l'éleveur pour vous prévenir au moment du retrait."
            />
          </div>

          <div className="mt-6 flex items-start justify-between gap-4 rounded-xl border border-terroir-border bg-terroir-bg/60 p-4">
            <div className="flex-1">
              <label
                htmlFor="sms-opt-in"
                className="block text-sm font-medium text-terroir-ink"
              >
                Notifications SMS
              </label>
              <p className="mt-1 text-xs text-terroir-muted">
                Recevez un rappel la veille du retrait. Optionnel.
              </p>
            </div>
            <button
              id="sms-opt-in"
              type="button"
              role="switch"
              aria-checked={profil.smsOptIn}
              onClick={() => update("smsOptIn")(!profil.smsOptIn)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-terroir-green-700 focus:ring-offset-2 ${
                profil.smsOptIn
                  ? "bg-terroir-green-700"
                  : "bg-terroir-border"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  profil.smsOptIn ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="mt-8 flex items-center justify-end gap-4">
            {saved ? (
              <span className="text-sm text-terroir-green-700" role="status">
                Modifications enregistrées.
              </span>
            ) : null}
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </form>
      </main>
      <Footer />
    </div>
  );
}

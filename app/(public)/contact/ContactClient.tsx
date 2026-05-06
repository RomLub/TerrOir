"use client";

import { useState } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui";

// Sub-client form du Server Component /contact (audit Vercel React perf
// 2026-05-05). Soumet POST /api/contact qui gère validation Zod, rate-limit
// applicatif (3/h/IP), honeypot anti-bot et envoi email Resend.
//
// Validation client : champs requis + email + message ≥ 20 chars + consent.
// La validation serveur est la source de vérité : la validation client est
// uniquement un garde-fou UX (évite un round-trip pour erreurs évidentes).

const SUJET_OPTIONS = [
  { value: "question", label: "Une question générale" },
  { value: "commande", label: "Une question sur ma commande" },
  { value: "producteur", label: "Devenir producteur" },
  { value: "presse", label: "Demande presse / partenariat" },
  { value: "autre", label: "Autre" },
];

const MIN_MESSAGE_LENGTH = 20;

type Status = "idle" | "submitting" | "success" | "error";

type FormState = {
  sujet: string;
  nom: string;
  email: string;
  telephone: string;
  message: string;
  consent: boolean;
  // Honeypot anti-bot : champ caché. Les bots remplissent tous les champs
  // d'un form, l'humain ne voit pas celui-ci. Si rempli côté serveur, la
  // requête est silencieusement avalée (faux 200 sans envoi).
  website: string;
};

const INITIAL_FORM: FormState = {
  sujet: "question",
  nom: "",
  email: "",
  telephone: "",
  message: "",
  consent: false,
  website: "",
};

export function ContactClient() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const update =
    <K extends keyof FormState>(key: K) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const target = e.target as HTMLInputElement;
      const value =
        target.type === "checkbox" ? target.checked : target.value;
      setForm((f) => ({ ...f, [key]: value as FormState[K] }));
    };

  const trimmedMessage = form.message.trim();
  const trimmedNom = form.nom.trim();
  const trimmedEmail = form.email.trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

  const valid =
    !!form.sujet &&
    trimmedNom.length > 0 &&
    emailValid &&
    trimmedMessage.length >= MIN_MESSAGE_LENGTH &&
    form.consent;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || status === "submitting") return;
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sujet: form.sujet,
          nom: trimmedNom,
          email: trimmedEmail.toLowerCase(),
          telephone: form.telephone.trim() || undefined,
          message: trimmedMessage,
          consent: form.consent,
          website: form.website,
        }),
      });

      if (!res.ok) {
        const payload = (await res
          .json()
          .catch(() => null)) as { error?: string } | null;
        setStatus("error");
        setErrorMessage(
          payload?.error ??
            (res.status === 429
              ? "Tu as envoyé plusieurs messages récemment. Merci de patienter avant de réessayer."
              : "Impossible d'envoyer ton message. Merci de réessayer."),
        );
        return;
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage(
        "Erreur réseau. Vérifie ta connexion et réessaie.",
      );
    }
  };

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-green-700 bg-green-100/40 p-8 md:p-10 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-green-700 flex items-center justify-center text-white text-2xl">
          ✓
        </div>
        <h2 className="mt-5 font-serif text-[28px] text-green-900 leading-tight">
          Message reçu
        </h2>
        <p className="mt-3 text-[15px] text-dark/75 leading-relaxed">
          Nous avons bien reçu ton message. Un membre de l&apos;équipe TerrOir
          te répondra sous 24 heures ouvrées à l&apos;adresse{" "}
          <strong>{trimmedEmail}</strong>.
        </p>
      </div>
    );
  }

  const submitting = status === "submitting";

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={submitting}
      className="rounded-2xl border border-dark/[0.08] bg-white p-6 md:p-8 shadow-soft space-y-5"
      noValidate
    >
      <h2 className="font-serif text-[26px] md:text-[30px] text-green-900 leading-tight">
        Écris-nous
      </h2>

      {/* Honeypot caché : tabIndex=-1 + autoComplete=off + visuellement masqué.
          Aria-hidden pour exclure des lecteurs d'écran. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-10000px",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      >
        <label htmlFor="contact-website">Site web (laisse vide)</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={update("website")}
        />
      </div>

      <Select
        name="sujet"
        label="Sujet"
        value={form.sujet}
        onChange={update("sujet")}
        options={SUJET_OPTIONS}
        required
        disabled={submitting}
      />

      <div className="grid sm:grid-cols-2 gap-4">
        <Input
          name="nom"
          label="Nom"
          value={form.nom}
          onChange={update("nom")}
          autoComplete="name"
          required
          disabled={submitting}
        />
        <Input
          name="email"
          label="Email"
          type="email"
          value={form.email}
          onChange={update("email")}
          autoComplete="email"
          required
          disabled={submitting}
        />
      </div>

      <Input
        name="telephone"
        label="Téléphone (optionnel)"
        type="tel"
        value={form.telephone}
        onChange={update("telephone")}
        autoComplete="tel"
        disabled={submitting}
      />

      <Textarea
        name="message"
        label="Ton message"
        rows={6}
        value={form.message}
        onChange={update("message")}
        required
        disabled={submitting}
        placeholder="Détaille ta demande pour qu'on puisse te répondre au mieux."
        hint={
          trimmedMessage.length > 0 && trimmedMessage.length < MIN_MESSAGE_LENGTH
            ? `Encore ${MIN_MESSAGE_LENGTH - trimmedMessage.length} caractère${MIN_MESSAGE_LENGTH - trimmedMessage.length > 1 ? "s" : ""}…`
            : undefined
        }
      />

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          required
          checked={form.consent}
          onChange={update("consent")}
          disabled={submitting}
          className="mt-1 h-4 w-4"
        />
        <span className="text-[13px] text-dark/70 leading-snug">
          J&apos;accepte que mes données soient utilisées par l&apos;équipe
          TerrOir pour répondre à ma demande. Voir notre{" "}
          <a
            href="/politique-confidentialite"
            className="text-green-900 underline decoration-dotted underline-offset-4 hover:text-terra-700"
          >
            politique de confidentialité
          </a>
          .
        </span>
      </label>

      {errorMessage && (
        <p
          role="alert"
          className="text-[13px] text-terra-700 bg-terra-100/40 rounded-md px-3 py-2"
        >
          {errorMessage}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!valid || submitting}
      >
        {submitting ? "Envoi…" : "Envoyer le message"}
      </Button>
    </form>
  );
}

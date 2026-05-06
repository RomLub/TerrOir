"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Affiché à la place du bouton "Ajouter au panier" sur la fiche produit
// quand le produit est indisponible (stock_disponible=0 AND !stock_illimite).
//
// Soumet POST /api/stock-alerts (PUSH 4) avec le consentement RGPD
// explicite + double opt-in côté serveur. Pré-remplit l'email si le
// consumer est connecté (best-effort, pattern aligné /catalogue/page.tsx).

type Props = {
  productId: string;
  productName: string;
};

type Status = "idle" | "submitting" | "created" | "already_active" | "error";

export function StockAlertForm({ productId, productName }: Props) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled && user?.email) {
        setEmail(user.email);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/stock-alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          email: email.trim().toLowerCase(),
          consent,
        }),
      });
      if (!res.ok) {
        const payload = (await res
          .json()
          .catch(() => null)) as { error?: string } | null;
        setStatus("error");
        setErrorMessage(payload?.error ?? `Erreur serveur (${res.status}).`);
        return;
      }
      const payload = (await res.json()) as { status: string };
      setStatus(
        payload.status === "already_active" ? "already_active" : "created",
      );
    } catch (e) {
      setStatus("error");
      setErrorMessage((e as Error).message ?? "Erreur réseau.");
    }
  };

  if (status === "created") {
    return (
      <div className="rounded-2xl border border-green-700 bg-green-50 p-5">
        <p className="text-[14px] font-medium text-green-900">
          Vérifie ta boîte mail.
        </p>
        <p className="text-[13px] text-dark/70 mt-1 leading-relaxed">
          Un email de confirmation vient d&apos;être envoyé à <strong>{email}</strong>.
          Clique le lien pour activer ton alerte — valable 7 jours.
        </p>
      </div>
    );
  }

  if (status === "already_active") {
    return (
      <div className="rounded-2xl border border-dark/[0.08] bg-bg p-5">
        <p className="text-[14px] font-medium text-green-900">
          Tu es déjà inscrit(e).
        </p>
        <p className="text-[13px] text-dark/70 mt-1 leading-relaxed">
          Tu seras prévenu(e) au retour en stock de {productName}.
        </p>
      </div>
    );
  }

  const submitting = status === "submitting";
  const canSubmit = !submitting && consent && email.trim().length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={submitting}
      className="rounded-2xl border border-dark/[0.08] bg-white p-5"
    >
      <h3 className="font-serif text-[20px] text-green-900 leading-tight">
        Me prévenir au retour en stock
      </h3>
      <p className="text-[13px] text-dark/60 mt-1 leading-relaxed">
        Saisis ton email — tu recevras un message dès que le producteur
        réapprovisionne.
      </p>

      <label
        htmlFor="stock-alert-email"
        className="block text-[12px] font-medium text-dark/70 mt-4 mb-1"
      >
        Ton email
      </label>
      <input
        id="stock-alert-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
        placeholder="toi@exemple.com"
        className="w-full rounded-md border border-dark/15 px-3 py-2 text-[14px] focus:border-terra-700 focus:outline-none disabled:bg-dark/[0.04]"
        aria-describedby={errorMessage ? "stock-alert-error" : undefined}
      />

      <label className="mt-3 flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={submitting}
          className="h-4 w-4 mt-1"
        />
        <span className="text-[12px] text-dark/70 leading-snug">
          J&apos;accepte de recevoir un email automatique au retour en stock. Je
          peux me désabonner à tout moment via le lien en pied d&apos;email.
        </span>
      </label>

      {errorMessage && (
        <p
          id="stock-alert-error"
          role="alert"
          className="text-[13px] text-terra-700 mt-3"
        >
          {errorMessage}
        </p>
      )}

      <div className="mt-4">
        <Button
          type="submit"
          variant="accent"
          size="lg"
          className="w-full"
          disabled={!canSubmit}
        >
          {submitting ? "Envoi…" : "Me prévenir"}
        </Button>
      </div>
    </form>
  );
}

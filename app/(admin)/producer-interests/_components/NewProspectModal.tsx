"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Textarea } from "@/components/ui";
import { CommuneSelect } from "@/components/ui/commune-select";

// Chantier 3 Phase 3 — création manuelle d'un lead prospecté (étape 1 « Repéré »)
// par l'admin. POST /api/admin/leads/prospects (source invitation_directe).

export function NewProspectModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    prenom: "",
    nom: "",
    email: "",
    telephone: "",
    nom_exploitation: "",
    code_postal: "",
    commune: "",
    message: "",
  });

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const valid = form.nom.trim() && form.email.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/leads/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prenom: form.prenom.trim() || undefined,
          nom: form.nom.trim(),
          email: form.email.trim().toLowerCase(),
          telephone: form.telephone.trim() || undefined,
          nom_exploitation: form.nom_exploitation.trim() || undefined,
          commune: form.commune.trim() || undefined,
          message: form.message.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Création impossible.");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("Erreur réseau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-xl text-green-900">Nouveau prospect</h2>
        <p className="mt-1 text-sm text-dark/60">
          Lead repéré manuellement (étape 1 du parcours prospecté).
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Prénom" value={form.prenom} onChange={set("prenom")} />
            <Input label="Nom" value={form.nom} onChange={set("nom")} required />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email} onChange={set("email")} required />
            <Input label="Téléphone" type="tel" value={form.telephone} onChange={set("telephone")} />
          </div>
          <Input
            label="Exploitation"
            value={form.nom_exploitation}
            onChange={set("nom_exploitation")}
          />
          <CommuneSelect
            idPrefix="new-prospect"
            defaultCodePostal={form.code_postal}
            defaultCommune={form.commune}
            onCodePostalChange={(v) => setForm((f) => ({ ...f, code_postal: v }))}
            onCommuneChange={(v) => setForm((f) => ({ ...f, commune: v }))}
          />
          <Textarea label="Note (optionnel)" rows={3} value={form.message} onChange={set("message")} />

          {error ? (
            <p className="text-sm text-terra-700">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              {busy ? "Création…" : "Créer le prospect"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

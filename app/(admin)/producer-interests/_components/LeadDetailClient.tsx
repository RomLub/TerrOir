"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { LeadFunnel } from "./LeadFunnel";
import { LeadSourceBadge } from "./LeadSourceBadge";
import {
  funnelSteps,
  isProspect,
  stepLabel,
} from "@/lib/admin/producer-interests/funnel";
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_DIRECTIONS,
  type AdminProducerInterestRow,
  type LeadFollowupRow,
} from "@/lib/admin/producer-interests/types";

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  phone: "Téléphone",
  rdv: "RDV",
};
const DIRECTION_LABEL: Record<string, string> = {
  outbound: "Sortant",
  inbound: "Entrant",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function LeadDetailClient({
  lead,
  followups,
  referents,
  authorNames,
}: {
  lead: AdminProducerInterestRow;
  followups: LeadFollowupRow[];
  referents: { id: string; label: string }[];
  authorNames: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form interaction
  const [channel, setChannel] = useState<string>("phone");
  const [direction, setDirection] = useState<string>("outbound");
  const [note, setNote] = useState("");

  const prospect = isProspect(lead.source);
  const steps = funnelSteps(lead.source);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Action impossible.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Erreur réseau.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <Link href="/producer-interests" className="text-sm text-terra-700 underline">
          ← Tous les leads
        </Link>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <h1 className="font-serif text-2xl text-green-900">
            {[lead.prenom, lead.nom].filter(Boolean).join(" ") || lead.email}
          </h1>
          <LeadSourceBadge source={lead.source} />
          {lead.abandoned_at ? (
            <span className="rounded-full bg-dark/10 px-3 py-1 text-xs text-dark/60">
              Abandonné — {lead.abandoned_reason ?? "sans motif"}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg bg-terra-50 border border-terra-200 px-4 py-2 text-sm text-terra-800">
          {error}
        </div>
      ) : null}

      {/* Frise */}
      <section className="rounded-xl border border-dark/[0.08] bg-white p-5">
        <h2 className="text-sm font-semibold text-dark/70 mb-3">
          Parcours {prospect ? "prospecté" : "spontané"}
        </h2>
        <LeadFunnel
          source={lead.source}
          currentStep={lead.current_step}
          abandoned={Boolean(lead.abandoned_at)}
        />
      </section>

      {/* Infos */}
      <section className="rounded-xl border border-dark/[0.08] bg-white p-5 grid sm:grid-cols-2 gap-3 text-sm">
        <Info label="Email" value={lead.email} />
        <Info label="Téléphone" value={lead.telephone ?? "—"} />
        <Info label="Exploitation" value={lead.nom_exploitation ?? "—"} />
        <Info label="Commune" value={lead.commune ?? "—"} />
        <Info label="Espèces" value={lead.especes?.join(", ") || "—"} />
        <Info label="Créé le" value={fmt(lead.created_at)} />
        <Info label="1er contact" value={fmt(lead.first_contact_at)} />
        <Info label="Dernier contact" value={fmt(lead.last_contact_at)} />
        {lead.message ? (
          <div className="sm:col-span-2">
            <Info label="Message" value={lead.message} />
          </div>
        ) : null}
      </section>

      {/* Actions */}
      <section className="rounded-xl border border-dark/[0.08] bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-dark/70">Actions</h2>

        <div className="flex flex-wrap items-end gap-3">
          {/* Avancer étape */}
          <label className="text-sm">
            <span className="block text-dark/60 mb-1">Étape</span>
            <select
              defaultValue={String(lead.current_step)}
              disabled={busy}
              onChange={(e) =>
                call(`/api/admin/leads/${lead.id}/step`, "PATCH", {
                  step: Number(e.target.value),
                })
              }
              className="rounded-lg border border-dark/15 px-3 py-2"
            >
              {steps.map((label, i) => (
                <option key={label} value={i + 1}>
                  {i + 1}. {label}
                </option>
              ))}
            </select>
          </label>

          {/* Référent */}
          <label className="text-sm">
            <span className="block text-dark/60 mb-1">Référent</span>
            <select
              defaultValue={lead.assigned_to ?? ""}
              disabled={busy}
              onChange={(e) =>
                call(`/api/admin/leads/${lead.id}/assign`, "PATCH", {
                  assigned_to: e.target.value || null,
                })
              }
              className="rounded-lg border border-dark/15 px-3 py-2"
            >
              <option value="">Non assigné</option>
              {referents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          {prospect ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => call(`/api/admin/leads/${lead.id}/send-form`, "POST")}
            >
              Envoyer le formulaire
            </Button>
          ) : null}

          {!lead.abandoned_at ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Motif de l'abandon ?");
                if (reason && reason.trim()) {
                  call(`/api/admin/leads/${lead.id}/abandon`, "POST", {
                    reason: reason.trim(),
                  });
                }
              }}
            >
              Abandonner
            </Button>
          ) : null}
        </div>

        {/* Journaliser une interaction */}
        <form
          className="flex flex-wrap items-end gap-3 border-t border-dark/[0.06] pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await call(`/api/admin/leads/${lead.id}/followup`, "POST", {
              channel,
              direction,
              note: note.trim() || undefined,
            });
            if (ok) setNote("");
          }}
        >
          <label className="text-sm">
            <span className="block text-dark/60 mb-1">Canal</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="rounded-lg border border-dark/15 px-3 py-2"
            >
              {FOLLOWUP_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-dark/60 mb-1">Sens</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="rounded-lg border border-dark/15 px-3 py-2"
            >
              {FOLLOWUP_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABEL[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm flex-1 min-w-[200px]">
            <span className="block text-dark/60 mb-1">Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Compte-rendu de l'échange…"
              className="w-full rounded-lg border border-dark/15 px-3 py-2"
            />
          </label>
          <Button type="submit" disabled={busy}>
            Journaliser
          </Button>
        </form>
      </section>

      {/* Timeline */}
      <section className="rounded-xl border border-dark/[0.08] bg-white p-5">
        <h2 className="text-sm font-semibold text-dark/70 mb-3">
          Historique des interactions
        </h2>
        {followups.length === 0 ? (
          <p className="text-sm text-dark/50">Aucune interaction enregistrée.</p>
        ) : (
          <ul className="space-y-3">
            {followups.map((f) => (
              <li key={f.id} className="flex gap-3 text-sm">
                <span className="text-dark/45 tabular-nums whitespace-nowrap">
                  {fmt(f.occurred_at)}
                </span>
                <span className="flex-1">
                  <span className="font-medium text-dark/80">
                    {CHANNEL_LABEL[f.channel]} · {DIRECTION_LABEL[f.direction]}
                    {f.is_automatic ? " · auto" : ""}
                    {f.relance_step ? ` (R${f.relance_step})` : ""}
                  </span>
                  {f.note ? <span className="block text-dark/65">{f.note}</span> : null}
                  {f.created_by ? (
                    <span className="block text-[11px] text-dark/40">
                      par {authorNames[f.created_by] ?? "admin"}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-dark/40">
        Étape courante : {stepLabel(lead.source, lead.current_step)}
      </p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-dark/45 text-xs">{label}</span>
      <span className="text-dark/85">{value}</span>
    </div>
  );
}

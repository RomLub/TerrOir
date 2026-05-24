"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

// Chantier 9 — réponse à un email entrant. Doctrine « interlocuteur unique » :
// l'envoi part toujours de contact@ (côté serveur). Préremplissage standard :
// To = expéditeur, Subject = « Re: … », body avec le message original quoté.

type Props = {
  inboundId: string;
  toEmail: string;
  originalSubject: string | null;
  originalBody: string | null;
  originalFrom: string;
  originalDate: string;
  alreadyReplied: boolean;
};

function buildReSubject(subject: string | null): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: votre message";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

function buildQuoted(from: string, date: string, body: string | null): string {
  const quoted = (body ?? "")
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `\n\n----- Message original -----\nDe : ${from}\nLe : ${date}\n\n${quoted}`;
}

export function ReplyForm({
  inboundId,
  toEmail,
  originalSubject,
  originalBody,
  originalFrom,
  originalDate,
  alreadyReplied,
}: Props) {
  const router = useRouter();
  const [subject, setSubject] = useState(buildReSubject(originalSubject));
  const [body, setBody] = useState(
    buildQuoted(originalFrom, originalDate, originalBody),
  );
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function send() {
    if (!body.replace(/^>.*$/gm, "").trim()) {
      setError("Écrivez votre réponse au-dessus du message cité.");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/admin/mails/${inboundId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Erreur HTTP ${res.status}`);
        return;
      }
      setOkMsg("Réponse envoyée depuis contact@terroir-local.fr.");
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="font-serif text-[18px] text-gray-900">Répondre</h2>
      <p className="mt-1 text-[13px] text-gray-500">
        De : <strong>contact@terroir-local.fr</strong> · À : {toEmail}
        {alreadyReplied ? " · (déjà répondu une fois)" : ""}
      </p>

      {error ? (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {okMsg ? (
        <div className="mt-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          {okMsg}
        </div>
      ) : null}

      <div className="mt-4">
        <label className="block text-[13px] font-medium text-gray-700">Sujet</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none"
        />
      </div>
      <div className="mt-4">
        <label className="block text-[13px] font-medium text-gray-700">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-[13px] text-gray-900 focus:border-terroir-green-700 focus:outline-none"
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={send} disabled={busy}>
          Envoyer la réponse
        </Button>
        <span className="text-[12px] text-gray-400">
          Envoyé via contact@ (le destinataire répondra à contact@).
        </span>
      </div>
    </div>
  );
}

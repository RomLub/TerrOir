"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { exportMyDataAction } from "../_actions/export-data";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; filename: string }
  | { kind: "error"; message: string };

export function ExportDataButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setStatus({ kind: "loading" });
    startTransition(async () => {
      const result = await exportMyDataAction();
      if (!result.ok) {
        const message = errorMessage(result);
        setStatus({ kind: "error", message });
        return;
      }
      triggerDownload(result.filename, result.base64);
      setStatus({ kind: "success", filename: result.filename });
    });
  }

  return (
    <div className="space-y-3">
      <Button
        onClick={handleClick}
        disabled={isPending || status.kind === "loading"}
      >
        {status.kind === "loading" || isPending
          ? "Préparation du fichier…"
          : "Télécharger mes données"}
      </Button>
      {status.kind === "success" && (
        <p className="text-sm text-emerald-700">
          Téléchargement lancé&nbsp;: <code>{status.filename}</code>. Si rien ne
          se passe, vérifie le dossier de téléchargements de ton navigateur.
        </p>
      )}
      {status.kind === "error" && (
        <p className="text-sm text-red-700">{status.message}</p>
      )}
    </div>
  );
}

function errorMessage(
  result: Extract<
    Awaited<ReturnType<typeof exportMyDataAction>>,
    { ok: false }
  >,
): string {
  if (result.error === "unauthorized") {
    return "Tu n'es plus connecté. Reconnecte-toi puis relance l'export.";
  }
  if (result.error === "rate_limited") {
    const seconds = result.retryAfterSeconds ?? 0;
    const hours = Math.ceil(seconds / 3600);
    return `Tu as déjà demandé plusieurs exports récemment. Réessaie dans ${hours}h environ.`;
  }
  return "Erreur technique. Réessaie dans quelques instants.";
}

function triggerDownload(filename: string, base64: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Libérer l'URL après un tick pour laisser le navigateur lancer le DL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

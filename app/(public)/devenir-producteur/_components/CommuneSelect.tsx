"use client";

import { useEffect, useState } from "react";
import { Input, Select } from "@/components/ui";

// Champ « Code postal + Commune » contrôlé : la commune se choisit dans une
// liste alimentée par le code postal (POST /api/communes → geo.api.gouv.fr),
// au lieu d'une saisie libre. Repli en saisie libre si le service est
// indisponible ou si le CP ne renvoie aucune commune (jamais bloquant).
// Soumet `code_postal` et `commune` via les champs nommés.

const CP_RE = /^\d{5}$/;

export function CommuneSelect({
  defaultCodePostal = "",
  defaultCommune = "",
}: {
  defaultCodePostal?: string;
  defaultCommune?: string;
}) {
  const [cp, setCp] = useState(defaultCodePostal);
  const [commune, setCommune] = useState(defaultCommune);
  const [communes, setCommunes] = useState<string[]>(
    defaultCommune ? [defaultCommune] : [],
  );
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!CP_RE.test(cp)) return;
    let active = true;
    const ctrl = new AbortController();
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch("/api/communes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cp }),
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; communes?: string[] }
          | null;
        if (!active) return;
        if (res.ok && data?.ok && Array.isArray(data.communes)) {
          const list = data.communes;
          setCommunes(list);
          // Auto-sélection si une seule commune ; on garde la sélection
          // courante si elle reste valide, sinon on la réinitialise.
          setCommune((prev) =>
            list.length === 1
              ? list[0]
              : prev && list.includes(prev)
                ? prev
                : "",
          );
          setStatus("idle");
        } else {
          setCommunes([]);
          setStatus("error");
        }
      } catch (e) {
        if (active && !(e instanceof DOMException && e.name === "AbortError")) {
          setCommunes([]);
          setStatus("error");
        }
      }
    })();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [cp]);

  const hasList = communes.length > 0;

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Input
        label="Code postal"
        name="code_postal"
        value={cp}
        onChange={(e) => setCp(e.target.value.replace(/\D/g, "").slice(0, 5))}
        inputMode="numeric"
        autoComplete="postal-code"
        required
      />
      {hasList ? (
        <Select
          label="Commune"
          name="commune"
          value={commune}
          onChange={(e) => setCommune(e.target.value)}
          placeholder="Sélectionnez votre commune"
          options={communes.map((c) => ({ value: c, label: c }))}
          required
        />
      ) : (
        <Input
          label="Commune"
          name="commune"
          value={commune}
          onChange={(e) => setCommune(e.target.value)}
          hint={
            status === "loading"
              ? "Recherche des communes…"
              : status === "error"
                ? "Service indisponible — saisie libre"
                : CP_RE.test(cp)
                  ? "Aucune commune trouvée — saisie libre"
                  : "Renseignez d'abord le code postal"
          }
          autoComplete="address-level2"
          required
        />
      )}
    </div>
  );
}

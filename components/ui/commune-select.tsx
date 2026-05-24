"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "./input";
import { Select } from "./select";

// Champ « Code postal + Commune » contrôlé : la commune se choisit dans une
// liste alimentée par le code postal (POST /api/communes → geo.api.gouv.fr),
// au lieu d'une saisie libre. Repli en saisie libre si le service est
// indisponible ou si le code postal ne renvoie aucune commune (jamais bloquant).
//
// Deux modes d'intégration :
//   - Formulaire à soumission native : les champs portent name="code_postal" /
//     name="commune" → collectés par le <form>. (devenir-producteur)
//   - Formulaire à état contrôlé : passer onCodePostalChange / onCommuneChange,
//     le parent stocke les valeurs dans son state. (ma-page, paramètres, etc.)
//
// Conforme à la doctrine garde-fou-autocompletion-cp (POST, pas de log du CP).

const CP_RE = /^\d{5}$/;

export type CommuneSelectProps = {
  defaultCodePostal?: string;
  defaultCommune?: string;
  onCodePostalChange?: (cp: string) => void;
  onCommuneChange?: (commune: string) => void;
  /** Préfixe d'id unique (htmlFor des labels) si plusieurs instances. */
  idPrefix?: string;
};

export function CommuneSelect({
  defaultCodePostal = "",
  defaultCommune = "",
  onCodePostalChange,
  onCommuneChange,
  idPrefix = "cs",
}: CommuneSelectProps) {
  const [cp, setCp] = useState(defaultCodePostal);
  const [commune, setCommune] = useState(defaultCommune);
  const [communes, setCommunes] = useState<string[]>(
    defaultCommune ? [defaultCommune] : [],
  );
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  // Refs pour lire la valeur courante + le callback dans l'effet sans les
  // mettre en dépendances (éviter un refetch à chaque sélection de commune).
  const communeRef = useRef(commune);
  const onCommuneRef = useRef(onCommuneChange);
  useEffect(() => {
    communeRef.current = commune;
    onCommuneRef.current = onCommuneChange;
  });

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
          // Auto-sélection si une seule commune ; sinon on conserve la
          // sélection courante si elle reste valide, sinon on la vide.
          const prev = communeRef.current;
          const next =
            list.length === 1 ? list[0] : prev && list.includes(prev) ? prev : "";
          setCommune(next);
          onCommuneRef.current?.(next);
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

  function handleCp(value: string) {
    const cleaned = value.replace(/\D/g, "").slice(0, 5);
    setCp(cleaned);
    onCodePostalChange?.(cleaned);
  }

  function handleCommune(value: string) {
    setCommune(value);
    onCommuneChange?.(value);
  }

  const hasList = communes.length > 0;

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Input
        id={`${idPrefix}-code-postal`}
        label="Code postal"
        name="code_postal"
        value={cp}
        onChange={(e) => handleCp(e.target.value)}
        inputMode="numeric"
        autoComplete="postal-code"
        required
      />
      {hasList ? (
        <Select
          id={`${idPrefix}-commune`}
          label="Commune"
          name="commune"
          value={commune}
          onChange={(e) => handleCommune(e.target.value)}
          placeholder="Sélectionnez votre commune"
          options={communes.map((c) => ({ value: c, label: c }))}
          required
        />
      ) : (
        <Input
          id={`${idPrefix}-commune`}
          label="Commune"
          name="commune"
          value={commune}
          onChange={(e) => handleCommune(e.target.value)}
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

"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "./input";
import { Select } from "./select";

// Champ « Code postal + Commune » contrôlé : la commune se choisit dans une
// liste alimentée par le code postal (POST /api/public/communes → geo.api.gouv.fr),
// au lieu d'une saisie libre. Repli en saisie libre si le service est
// indisponible ou si le code postal ne renvoie aucune commune (jamais bloquant).
//
// UX code postal :
//   1. La commune est GRISÉE (lecture seule) tant qu'aucun code postal valide
//      n'est saisi.
//   2. Dès 2 chiffres tapés, une liste de suggestions de communes (avec leur
//      CP) s'affiche sous le champ (POST /api/public/communes/suggest → api-adresse).
//      Cliquer une suggestion remplit CP + commune.
//   3. Effacer / raccourcir le code postal vide automatiquement la commune.
//
// Deux modes d'intégration :
//   - Formulaire à soumission native : les champs portent name="code_postal" /
//     name="commune" → collectés par le <form>. (devenir-producteur, onboarding)
//   - Formulaire à état contrôlé : passer onCodePostalChange / onCommuneChange,
//     le parent stocke les valeurs dans son state. (ma-page, paramètres, etc.)
//
// Conforme à la doctrine garde-fou-autocompletion-cp (POST, pas de log du CP).

const CP_RE = /^\d{5}$/;

type Suggestion = { code_postal: string; commune: string };

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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Refs pour lire la valeur courante + le callback dans l'effet sans les
  // mettre en dépendances (éviter un refetch à chaque sélection de commune).
  const communeRef = useRef(commune);
  const onCommuneRef = useRef(onCommuneChange);
  useEffect(() => {
    communeRef.current = commune;
    onCommuneRef.current = onCommuneChange;
  });

  const validCp = CP_RE.test(cp);

  // Effet « liste de communes » : code postal complet → options du <select>.
  useEffect(() => {
    if (!CP_RE.test(cp)) {
      setCommunes([]);
      setStatus("idle");
      return;
    }
    let active = true;
    const ctrl = new AbortController();
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch("/api/public/communes", {
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

  // Effet « suggestions » (autocomplétion CP) : 2 à 4 caractères → propositions.
  useEffect(() => {
    if (cp.length < 2 || cp.length >= 5) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/public/communes/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: cp }),
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; suggestions?: Suggestion[] }
          | null;
        if (!active) return;
        if (res.ok && data?.ok && Array.isArray(data.suggestions)) {
          setSuggestions(data.suggestions);
          setShowSuggestions(true);
        } else {
          setSuggestions([]);
        }
      } catch {
        /* suggestions best-effort : on n'affiche rien en cas d'erreur */
      }
    }, 250);
    return () => {
      active = false;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [cp]);

  function handleCp(value: string) {
    const cleaned = value.replace(/\D/g, "").slice(0, 5);
    setCp(cleaned);
    onCodePostalChange?.(cleaned);
    // Point 3 : effacer / raccourcir le code postal vide la commune.
    if (!CP_RE.test(cleaned)) {
      setCommune("");
      onCommuneChange?.("");
    }
  }

  function pickSuggestion(s: Suggestion) {
    setShowSuggestions(false);
    setSuggestions([]);
    setCp(s.code_postal);
    onCodePostalChange?.(s.code_postal);
    setCommune(s.commune);
    onCommuneChange?.(s.commune);
    // L'effet « liste de communes » se déclenche (cp complet) et conservera
    // s.commune si elle figure dans la liste renvoyée.
  }

  function handleCommune(value: string) {
    setCommune(value);
    onCommuneChange?.(value);
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="relative">
        <Input
          id={`${idPrefix}-code-postal`}
          label="Code postal"
          name="code_postal"
          value={cp}
          onChange={(e) => handleCp(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true);
          }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Tapez votre code postal"
          required
        />
        {showSuggestions && suggestions.length > 0 ? (
          <ul
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-terroir-border bg-white shadow-lg"
            role="listbox"
          >
            {suggestions.map((s) => (
              <li key={`${s.code_postal}-${s.commune}`}>
                <button
                  type="button"
                  // onMouseDown (avant le blur du champ) pour que le clic soit
                  // pris en compte avant la fermeture de la liste.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSuggestion(s);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-terroir-ink hover:bg-green-100/60"
                >
                  <span>{s.commune}</span>
                  <span className="shrink-0 text-xs tabular-nums text-terroir-muted">
                    {s.code_postal}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {!validCp ? (
        // Point 1 : commune grisée (lecture seule) tant qu'il n'y a pas de CP.
        <Input
          id={`${idPrefix}-commune`}
          label="Commune"
          name="commune"
          value=""
          readOnly
          placeholder="Renseignez d'abord le code postal"
          tabIndex={-1}
          required
        />
      ) : status === "error" ? (
        // Service indisponible / aucune commune : repli saisie libre.
        <Input
          id={`${idPrefix}-commune`}
          label="Commune"
          name="commune"
          value={commune}
          onChange={(e) => handleCommune(e.target.value)}
          hint="Service indisponible — saisie libre"
          autoComplete="address-level2"
          required
        />
      ) : communes.length > 0 ? (
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
        // CP valide, communes en cours de chargement.
        <Input
          id={`${idPrefix}-commune`}
          label="Commune"
          name="commune"
          value=""
          readOnly
          placeholder="Recherche des communes…"
          tabIndex={-1}
          required
        />
      )}
    </div>
  );
}

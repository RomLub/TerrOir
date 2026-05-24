"use client";

import { useEffect, useState } from "react";
import { Input } from "./input";

// Champ « Adresse » avec autocomplétion filtrée par code postal : dès 3
// caractères, propose des adresses réelles de la commune saisie (POST
// /api/public/address/suggest → api-adresse.data.gouv.fr). Cliquer remplit le
// champ avec la voie (numéro + rue). Le code postal vient du champ commune
// (CommuneSelect) déjà renseigné en amont.
//
// Mode soumission native : le champ porte name={name} → collecté par le <form>.
// L'autocomplétion ne se déclenche que si un code postal valide est fourni.

const CP_RE = /^\d{5}$/;

type Suggestion = { label: string; name: string };

export type AddressAutocompleteProps = {
  /** Code postal de scope (depuis CommuneSelect). Suggestions actives si valide. */
  codePostal: string;
  name?: string;
  label?: string;
  defaultValue?: string;
  required?: boolean;
  hint?: string;
  idPrefix?: string;
};

export function AddressAutocomplete({
  codePostal,
  name = "adresse",
  label = "Adresse",
  defaultValue = "",
  required,
  hint,
  idPrefix = "addr",
}: AddressAutocompleteProps) {
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || !CP_RE.test(codePostal)) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/public/address/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, cp: codePostal }),
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
        /* best-effort : on n'affiche rien en cas d'erreur */
      }
    }, 250);
    return () => {
      active = false;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [value, codePostal]);

  function pick(s: Suggestion) {
    setShowSuggestions(false);
    setSuggestions([]);
    setValue(s.name);
  }

  return (
    <div className="relative">
      <Input
        id={`${idPrefix}-adresse`}
        label={label}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setShowSuggestions(true);
        }}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        autoComplete="off"
        placeholder="Numéro et rue"
        hint={hint}
        required={required}
      />
      {showSuggestions && suggestions.length > 0 ? (
        <ul
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border border-terroir-border bg-white shadow-lg"
          role="listbox"
        >
          {suggestions.map((s) => (
            <li key={s.label}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-terroir-ink hover:bg-green-100/60"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

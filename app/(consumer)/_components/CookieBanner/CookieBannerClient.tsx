"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  acceptAllConsent,
  buildConsent,
  rejectAllConsent,
} from "@/lib/rgpd/cookie-consent";
import { persistConsentInBrowser } from "./persist-consent";

// =============================================================================
// CookieBannerClient — UI interactive de la bannière. F-012.
// =============================================================================
// 3 actions :
//   - "Tout accepter" → essentials + analytics + marketing = true
//   - "Tout refuser" → essentials only (analytics + marketing = false)
//   - "Personnaliser" → ouvre un bloc avec 2 toggles (analytics, marketing)
//                       + bouton "Enregistrer mes choix"
//
// Les essentials sont toujours `true` et non-désactivables côté UI.
// =============================================================================

export function CookieBannerClient() {
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function acceptAll() {
    persistConsentInBrowser(acceptAllConsent());
    setDismissed(true);
  }

  function rejectAll() {
    persistConsentInBrowser(rejectAllConsent());
    setDismissed(true);
  }

  function saveCustom() {
    persistConsentInBrowser(buildConsent({ analytics, marketing }));
    setDismissed(true);
  }

  return (
    <div
      role="dialog"
      aria-label="Consentement cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-terroir-border bg-white shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-terroir-ink">
          <p className="font-medium">On respecte ta vie privée.</p>
          <p className="mt-1 text-terroir-muted">
            On utilise des cookies strictement nécessaires au fonctionnement
            du site. Les cookies de mesure d&rsquo;audience et marketing sont
            désactivés par défaut — tu choisis.{" "}
            <Link href="/cookies" className="underline">
              En savoir plus
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
            Personnaliser
          </Button>
          <Button variant="secondary" onClick={rejectAll}>
            Tout refuser
          </Button>
          <Button onClick={acceptAll}>Tout accepter</Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-terroir-border bg-terroir-bg">
          <div className="mx-auto max-w-5xl space-y-3 px-4 py-4 text-sm">
            <CategoryRow
              label="Cookies essentiels"
              description="Strictement nécessaires (session de connexion, panier). Toujours actifs."
              checked
              disabled
              onChange={() => {}}
            />
            <CategoryRow
              label="Mesure d'audience"
              description="Nous aide à comprendre comment le site est utilisé pour l'améliorer. Pas de revente de données."
              checked={analytics}
              disabled={false}
              onChange={setAnalytics}
            />
            <CategoryRow
              label="Marketing"
              description="Personnalisation des contenus (non utilisé aujourd'hui chez TerrOir, désactivé par défaut)."
              checked={marketing}
              disabled={false}
              onChange={setMarketing}
            />
            <div className="flex justify-end pt-2">
              <Button onClick={saveCustom}>Enregistrer mes choix</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="font-medium text-terroir-ink">{label}</span>
        <span className="block text-terroir-muted">{description}</span>
      </span>
    </label>
  );
}

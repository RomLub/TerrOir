"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  buildConsent,
  type CookieConsent,
} from "@/lib/rgpd/cookie-consent";
import { persistConsentInBrowser } from "@/app/(consumer)/_components/CookieBanner/persist-consent";

// =============================================================================
// CookieSettingsForm — page /cookies, modification du consent existant. F-012.
// =============================================================================
// Affiche l'état actuel (initialConsent passé par le server component) et
// permet de modifier les 2 catégories opt-in (analytics + marketing). Les
// essentials sont affichés mais non-modifiables (toujours true).
//
// Sauvegarde côté browser via persistConsentInBrowser (cookie HTTP).
// =============================================================================

export function CookieSettingsForm({
  initialConsent,
}: {
  initialConsent: CookieConsent;
}) {
  const [analytics, setAnalytics] = useState(initialConsent.analytics);
  const [marketing, setMarketing] = useState(initialConsent.marketing);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    persistConsentInBrowser(buildConsent({ analytics, marketing }));
    setSaved(true);
    // Reset le flag après 3s pour permettre une nouvelle sauvegarde silencieuse.
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="space-y-4">
      <Row
        label="Cookies essentiels"
        description="Session, panier, anti-CSRF. Toujours actifs."
        checked
        disabled
        onChange={() => {}}
      />
      <Row
        label="Mesure d'audience"
        description="Statistiques d'usage anonymisées."
        checked={analytics}
        disabled={false}
        onChange={setAnalytics}
      />
      <Row
        label="Marketing"
        description="Non utilisé aujourd'hui."
        checked={marketing}
        disabled={false}
        onChange={setMarketing}
      />
      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleSave}>Enregistrer mes choix</Button>
        {saved && (
          <span className="text-sm text-emerald-700">
            Préférences enregistrées.
          </span>
        )}
      </div>
    </div>
  );
}

function Row({
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
    <label className="flex items-start gap-3 rounded-md border border-terroir-border bg-white p-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        <span className="font-medium text-terroir-ink">{label}</span>
        <span className="block text-sm text-terroir-muted">{description}</span>
      </span>
    </label>
  );
}

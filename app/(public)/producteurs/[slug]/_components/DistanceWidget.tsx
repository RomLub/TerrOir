"use client";

import { useEffect, useMemo, useState } from "react";
import { haversineKm } from "@/lib/geo/haversine";
import {
  geocodePostalCode,
  GEOCODE_POSTAL_ERROR_MESSAGES,
} from "@/lib/geo/geocode-postal";
import {
  GMS_DISTANCE_KM_REFERENCE,
  GMS_DISTANCE_SOURCE_LABEL,
} from "@/lib/producers/score-carbone-enums";

// Persistance volontairement réduite à sessionStorage : aucune donnée
// ne survit à la fermeture de l'onglet (RGPD light, pas de cookie ni DB).
const SESSION_KEY = "terroir_geo_session";

// Validation regex code postal côté composant : defense in depth en plus
// de la validation côté lib (geocodePostalCode). Bloque le clic "OK" tant
// que le format n'est pas exactement 5 chiffres. Décision comité review T-200 r2.
const POSTAL_CODE_REGEX = /^\d{5}$/;

type GeoSource = "geoloc" | "postal";
type GeoSession = { lat: number; lng: number; source: GeoSource };

export type DistanceWidgetProps = {
  producerLat: number | null;
  producerLng: number | null;
  producerName: string;
};

function readSession(): GeoSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GeoSession>;
    if (
      typeof parsed.lat !== "number" ||
      typeof parsed.lng !== "number" ||
      (parsed.source !== "geoloc" && parsed.source !== "postal")
    ) {
      return null;
    }
    return { lat: parsed.lat, lng: parsed.lng, source: parsed.source };
  } catch {
    return null;
  }
}

function writeSession(session: GeoSession): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Quotas, mode privé : on ignore, le widget reste fonctionnel pour la session.
  }
}

function clearSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Idem.
  }
}

export function DistanceWidget({
  producerLat,
  producerLng,
  producerName,
}: DistanceWidgetProps) {
  const [session, setSession] = useState<GeoSession | null>(null);
  const [postalInput, setPostalInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSession(readSession());
  }, []);

  const distance = useMemo(() => {
    if (!session || producerLat === null || producerLng === null) return null;
    return haversineKm(session.lat, session.lng, producerLat, producerLng);
  }, [session, producerLat, producerLng]);

  // Producer sans coords : aucune comparaison possible, on n'affiche rien.
  // ScoreCarbonBlock gère déjà la condition pour ne pas afficher le titre
  // orphelin "Distance ferme → toi" — defense in depth ici.
  if (producerLat === null || producerLng === null) return null;

  // Avant le mount, on rend l'état d'invitation pour éviter un flash si
  // sessionStorage contenait une position. C'est cohérent avec un SSR vide.
  if (!mounted) {
    return <InvitePlaceholder producerName={producerName} />;
  }

  const handleGeoloc = () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible sur ce navigateur.");
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: GeoSession = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "geoloc",
        };
        writeSession(next);
        setSession(next);
        setPending(false);
      },
      (err) => {
        setPending(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError(
            "Autorisation refusée. Tu peux saisir ton code postal à la place.",
          );
        } else if (err.code === err.TIMEOUT) {
          setError("Délai dépassé. Réessaie ou saisis ton code postal.");
        } else {
          setError("Position indisponible. Saisis ton code postal à la place.");
        }
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  const handlePostal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await geocodePostalCode(postalInput);
    setPending(false);
    if (!result.ok) {
      setError(GEOCODE_POSTAL_ERROR_MESSAGES[result.code]);
      return;
    }
    const next: GeoSession = {
      lat: result.lat,
      lng: result.lng,
      source: "postal",
    };
    writeSession(next);
    setSession(next);
    setPostalInput("");
  };

  const handleReset = () => {
    clearSession();
    setSession(null);
    setError(null);
  };

  if (session && distance !== null) {
    return (
      <DistanceResult
        distance={distance}
        producerName={producerName}
        onReset={handleReset}
      />
    );
  }

  const isPostalValid = POSTAL_CODE_REGEX.test(postalInput);

  return (
    <div className="rounded-xl border border-terroir-border bg-white p-5">
      <p className="text-[14px] leading-[1.55] text-terroir-ink/[0.78]">
        Indique ta position pour découvrir la distance à vol d&apos;oiseau
        jusqu&apos;à {producerName}.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleGeoloc}
          disabled={pending}
          // h-11 = 44px : tap target a11y (Apple HIG / Android Material).
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-green-900 px-4 text-[13px] font-semibold text-white hover:bg-green-700 disabled:opacity-60"
        >
          <span aria-hidden>📍</span>
          {pending ? "Recherche…" : "Utiliser ma position"}
        </button>

        <form onSubmit={handlePostal} className="flex items-center gap-2">
          <label htmlFor="cp-input" className="sr-only">
            Code postal
          </label>
          <input
            id="cp-input"
            inputMode="numeric"
            pattern="\d{5}"
            maxLength={5}
            placeholder="Code postal"
            value={postalInput}
            onChange={(e) => setPostalInput(e.target.value)}
            className="h-11 w-32 rounded-lg border border-terroir-border bg-white px-3 text-[14px] text-terroir-ink placeholder:text-terroir-muted focus:outline-none focus:ring-2 focus:ring-green-700/40"
          />
          <button
            type="submit"
            disabled={pending || !isPostalValid}
            className="inline-flex h-11 items-center rounded-lg border border-terroir-border bg-white px-3 text-[13px] font-semibold text-green-900 hover:bg-green-100/60 disabled:opacity-60"
          >
            OK
          </button>
        </form>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 text-[13px] leading-[1.5] text-red-700"
        >
          {error}
        </p>
      )}

      <PrivacyNote />
    </div>
  );
}

function InvitePlaceholder({ producerName }: { producerName: string }) {
  return (
    <div className="rounded-xl border border-terroir-border bg-white p-5">
      <p className="text-[14px] leading-[1.55] text-terroir-ink/[0.78]">
        Indique ta position pour découvrir la distance à vol d&apos;oiseau
        jusqu&apos;à {producerName}.
      </p>
      <PrivacyNote />
    </div>
  );
}

function PrivacyNote() {
  // Information RGPD au point de collecte (art. 13 RGPD) : finalité explicite
  // (calcul de distance), durée de conservation (session navigateur uniquement,
  // non persistée côté serveur), et sous-traitant tiers (api-adresse.data.gouv.fr,
  // service public). Wording enrichi suite au comité review T-200 round 2.
  return (
    <p className="mt-4 text-[11px] leading-[1.5] text-terroir-ink/[0.55]">
      Ta position est utilisée uniquement pour calculer la distance jusqu&apos;à
      la ferme. Elle reste dans ton navigateur (session uniquement, non
      conservée), jamais envoyée à nos serveurs. La saisie d&apos;un code postal
      interroge le service public api-adresse.data.gouv.fr.
    </p>
  );
}

function DistanceResult({
  distance,
  producerName,
  onReset,
}: {
  distance: number;
  producerName: string;
  onReset: () => void;
}) {
  const ref = GMS_DISTANCE_KM_REFERENCE;
  // Ratio visuel borné [0,1] : la barre du producteur est proportionnelle à
  // la référence circuit long. Un producteur très lointain s'aligne au max.
  const ratio = Math.max(0.04, Math.min(distance / ref, 1));
  return (
    <div className="rounded-xl border border-terroir-border bg-white p-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700">
            Jusqu&apos;à toi
          </div>
          <div className="mt-1 font-serif text-[44px] leading-none text-green-900 md:text-[52px]">
            {distance} <span className="text-[22px] md:text-[26px]">km</span>
          </div>
          <p className="mt-2 text-[13px] leading-[1.5] text-terroir-ink/[0.7]">
            à vol d&apos;oiseau jusqu&apos;à toi depuis {producerName}.
          </p>
        </div>
        <div className="md:border-l md:border-terroir-border md:pl-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-muted">
            En circuit long
          </div>
          <div className="mt-1 font-serif text-[28px] leading-none text-terroir-ink/[0.55] md:text-[32px]">
            ~{ref} km
          </div>
          <p className="mt-2 text-[13px] leading-[1.5] text-terroir-ink/[0.6]">
            en moyenne en circuit long (importation, centrale d&apos;achat,
            entrepôts).
          </p>
          <p className="mt-1 text-[11px] leading-[1.4] text-terroir-ink/[0.45]">
            {GMS_DISTANCE_SOURCE_LABEL}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-terroir-muted">
          <span>Toi ↔ ferme</span>
          <span>~{ref} km</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-terroir-border/60">
          <div
            className="h-full rounded-full bg-green-700"
            style={{ width: `${Math.round(ratio * 100)}%` }}
            aria-hidden
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onReset}
        // h-9 = 36px : action secondaire textuelle, pas de tap target
        // critique. Le bouton primaire (Utiliser ma position) reste à 44px.
        className="mt-4 inline-flex h-9 items-center text-[12px] text-terroir-ink/[0.55] underline-offset-2 hover:text-green-900 hover:underline"
      >
        Changer ma position
      </button>

      <PrivacyNote />
    </div>
  );
}

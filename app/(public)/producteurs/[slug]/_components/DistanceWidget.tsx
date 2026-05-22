"use client";

import { useEffect, useMemo, useState } from "react";
import { DISTANCE_OUT_OF_REACH_KM, haversineKm } from "@/lib/geo/haversine";
import { GEOCODE_POSTAL_ERROR_MESSAGES } from "@/lib/geo/geocode-postal";
import { geocodePostalCodeViaApi } from "@/lib/geo/geocode-postal-client";
import {
  GMS_DISTANCE_KM_REFERENCE,
  GMS_DISTANCE_SOURCE_LABEL,
} from "@/lib/producers/gms-distance";

// Persistance volontairement réduite à sessionStorage : aucune donnée
// ne survit à la fermeture de l'onglet (RGPD light, pas de cookie ni DB).
//
// WHY clé GLOBALE (non scopée par producerId) — décision T-240 r2 :
// la clé stocke uniquement les coordonnées du CONSUMER (lat/lng + source),
// jamais une distance pré-calculée. La distance par fiche producteur est
// recalculée à chaque mount via Haversine (useMemo, cf. ligne 111). Effet
// produit voulu : un visiteur qui a saisi son CP sur la fiche A retrouve
// directement "12 km" sur la fiche B sans re-saisir.
//
// ⚠️ Régression à prévenir : si un futur dev voulait "optimiser" en stockant
// la distance pré-calculée (ex. { lat, lng, distanceKm: 12, source }), le
// même chiffre s'afficherait sur toutes les fiches du même onglet (toutes
// les fiches afficheraient "12 km" même celles à 250 km). Garder le stockage
// strictement aux INPUTS du calcul (coords consumer), jamais aux OUTPUTS
// (distance par producteur). T-267.
const SESSION_KEY = "terroir_geo_session";

// Validation regex code postal côté composant : defense in depth en plus
// de la validation côté lib (geocodePostalCode). Bloque le clic "OK" tant
// que le format n'est pas exactement 5 chiffres. Décision comité review T-200 r2.
const POSTAL_CODE_REGEX = /^\d{5}$/;

// A11y disclosure (T-273) — pattern WAI-ARIA "Disclosure" :
//   - le bouton replié (CollapsedButton) porte `aria-expanded={false}` +
//     `aria-controls={PANEL_ID}` : le screen reader annonce "collapsed"
//     et fait le lien avec le panneau en cas de support (NVDA, VoiceOver).
//   - le panneau déployé porte `id={PANEL_ID}`.
//   - les liens "Masquer" portent `aria-expanded={true}` + le même
//     `aria-controls`. Multiple triggers sur un même panneau est ARIA-valide
//     (ex. "Masquer" mobile + "Masquer" desktop dans DistanceResult).
// Pas de focus management explicite au toggle : le pattern Disclosure
// classique laisse le focus là où il est (l'utilisateur clavier reste sur
// le bouton qu'il vient d'activer, le contenu est lu post-render). Refacto
// disclosure plus profond → T-256 (dette a11y consciente).
const PANEL_ID = "distance-widget-panel";

type GeoSource = "geoloc" | "postal";
type GeoSession = { lat: number; lng: number; source: GeoSource };

// Fallback wording noms longs (T-233) — au-delà du seuil, le nom est
// substitué par "cette ferme" pour préserver l'équilibre visuel des phrases
// "jusqu'à {name}", "depuis {name}", "{name} se trouve...". Seuil 30 chars
// dérivé du benchmark des noms producteurs onboardés (médiane ~18 chars,
// 90e percentile ~28 chars). Au-delà, la concaténation casse mobile.
//
// Pas de troncature `…` choisie : sur la fiche, l'utilisateur LIT déjà le
// nom complet en haut, donc il sait de qui on parle. La formulation neutre
// "cette ferme" est plus naturelle qu'un nom mutilé. Cohérent avec le
// vocabulaire existant ("Toi ↔ ferme" dans la barre de comparaison).
//
// Note T-211 (backlog) : "ferme" est imprécis pour maraîchers/boulangers/
// apiculteurs ; quand les indicateurs adaptés par métier seront livrés,
// rebrancher ce fallback sur le terme par `type_production`.
const NAME_FALLBACK_THRESHOLD = 30;
const NAME_FALLBACK_LABEL = "cette ferme";

export function formatProducerNameForWidget(name: string): string {
  return name.length > NAME_FALLBACK_THRESHOLD ? NAME_FALLBACK_LABEL : name;
}

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
    // Validation défensive (T-239+T-240 r3) : sessionStorage est partagé
    // avec n'importe quel script de l'origine, on ne fait confiance ni au
    // type, ni aux plages, ni au champ source. Toute incohérence → fallback
    // silencieux sur l'état compact "Voir la distance" (le widget reste
    // utilisable, l'utilisateur peut re-saisir).
    // - typeof === "number" exclut string/null/undefined (mais pas NaN).
    // - Number.isFinite exclut NaN et ±Infinity.
    // - Plages WGS84 standard : lat ∈ [-90, 90], lng ∈ [-180, 180].
    if (
      typeof parsed.lat !== "number" ||
      typeof parsed.lng !== "number" ||
      !Number.isFinite(parsed.lat) ||
      !Number.isFinite(parsed.lng) ||
      parsed.lat < -90 ||
      parsed.lat > 90 ||
      parsed.lng < -180 ||
      parsed.lng > 180 ||
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
  // Replié par défaut (T-240) : le widget occupe une seule ligne tant que
  // l'utilisateur ne demande pas explicitement à voir la distance.
  const [expanded, setExpanded] = useState(false);

  // Lecture sessionStorage côté client uniquement (post-mount), pour 2 raisons :
  //   1. SSR : sessionStorage n'existe pas côté serveur. Lire au premier render
  //      provoquerait un mismatch d'hydratation (le serveur sortirait l'état
  //      neutre, le client un autre HTML). On rend toujours le bouton compact
  //      "Voir la distance jusqu'à toi" en SSR + premier render client (cf.
  //      `if (!mounted)` plus bas), puis on synchronise.
  //   2. Choix produit (T-240 r1, décision Romain) : si une session existe
  //      déjà (l'utilisateur a saisi sa position sur la fiche d'un autre
  //      producteur dans le même onglet), on RESTE replié mais le bouton
  //      compact affiche directement la distance recalculée pour CE producteur
  //      ("📍 12 km à vol d'oiseau"). Pas d'auto-expand : on ne réimpose pas
  //      le bloc déployé à chaque visite, l'utilisateur déplie s'il veut voir
  //      le détail (comparaison circuit long, RGPD, "Changer ma position").
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

  // Avant le mount, on rend le bouton compact en état "neutre" pour éviter
  // un flash si sessionStorage contenait une distance. Cohérent avec un SSR vide.
  if (!mounted) {
    return <CollapsedButton label="Voir la distance jusqu'à toi" disabled />;
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
    // T-219 : passe par /api/geocode (cache Supabase + rate-limit Upstash)
    // au lieu de taper api-adresse.data.gouv.fr en direct depuis le client.
    const result = await geocodePostalCodeViaApi(postalInput);
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

  // Bascule "hors zone circuit court" (T-230) : au-delà de
  // DISTANCE_OUT_OF_REACH_KM, on n'affiche plus la distance brute ni la
  // comparaison ~1500 km (le ratio s'écrase et l'argument se retourne :
  // "Plus loin que le supermarché"). Cas typique : visiteur DOM-TOM saisissant
  // son CP outre-mer sur la fiche d'un producteur métropolitain.
  const outOfReach = distance !== null && distance > DISTANCE_OUT_OF_REACH_KM;

  // État replié : bouton compact 1 ligne. Le label porte la distance si on
  // a déjà une session valide, l'invite générique sinon. Le clic bascule
  // vers l'état déployé.
  if (!expanded) {
    const label = outOfReach
      ? "Hors zone circuit court"
      : distance !== null
        ? `${distance} km à vol d'oiseau`
        : "Voir la distance jusqu'à toi";
    return (
      <CollapsedButton label={label} onClick={() => setExpanded(true)} />
    );
  }

  // État déployé avec session valide :
  //  - hors zone : message dédié sans distance brute ni comparaison GMS.
  //  - sinon : résultat complet (barre + comparaison + RGPD).
  if (session && distance !== null) {
    if (outOfReach) {
      return (
        <DistanceOutOfReach
          producerName={producerName}
          onReset={handleReset}
          onCollapse={() => setExpanded(false)}
        />
      );
    }
    return (
      <DistanceResult
        distance={distance}
        producerName={producerName}
        onReset={handleReset}
        onCollapse={() => setExpanded(false)}
      />
    );
  }

  // État déployé sans session : invite + bouton géoloc + code postal + RGPD.
  const isPostalValid = POSTAL_CODE_REGEX.test(postalInput);
  const displayName = formatProducerNameForWidget(producerName);

  return (
    <div id={PANEL_ID} className="rounded-xl border border-terroir-border bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] leading-[1.55] text-terroir-ink/[0.78]">
          Indique ta position pour découvrir la distance à vol d&apos;oiseau
          jusqu&apos;à {displayName}.
        </p>
        <CollapseLink onClick={() => setExpanded(false)} />
      </div>

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
            disabled={pending}
            className="h-11 w-32 rounded-lg border border-terroir-border bg-white px-3 text-[14px] text-terroir-ink placeholder:text-terroir-muted focus:outline-none focus:ring-2 focus:ring-green-700/40 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !isPostalValid}
            aria-busy={pending}
            className="inline-flex h-11 items-center rounded-lg border border-terroir-border bg-white px-3 text-[13px] font-semibold text-green-900 hover:bg-green-100/60 disabled:opacity-60"
          >
            {pending ? "Calcul…" : "OK"}
          </button>
        </form>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 text-[13px] leading-normal text-red-700"
        >
          {error}
        </p>
      )}

      <PrivacyNote />
    </div>
  );
}

function CollapsedButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // A11y T-273 : pattern Disclosure — bouton replié, lié au panneau via
      // aria-controls. aria-expanded=false annonce l'état au screen reader.
      aria-expanded={false}
      aria-controls={PANEL_ID}
      // h-11 = 44px tap target. Volontairement sobre (variant secondaire
      // outline) pour ne pas concurrencer le CTA primaire de la fiche.
      className="inline-flex h-11 items-center gap-2 rounded-lg border border-terroir-border bg-white px-4 text-[13px] font-semibold text-green-900 hover:bg-green-100/60 disabled:opacity-60"
    >
      <span aria-hidden>📍</span>
      {label}
    </button>
  );
}

function CollapseLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // A11y T-273 : second trigger du même panneau (multi-trigger valide
      // ARIA). aria-expanded=true annonce l'état déployé courant ; le clic
      // bascule vers replié.
      aria-expanded={true}
      aria-controls={PANEL_ID}
      aria-label="Masquer le détail de la distance"
      className="shrink-0 text-[12px] text-terroir-ink/[0.55] underline-offset-2 hover:text-green-900 hover:underline"
    >
      Masquer
    </button>
  );
}

function PrivacyNote() {
  // Information RGPD au point de collecte (art. 13 RGPD) — wording mis à
  // jour T-263 (mention explicite sessionStorage) en complément de T-219
  // (cache serveur géocodage CP→coords) :
  //   (a) finalité explicite : calcul de distance.
  //   (b) caractère facultatif : la fiche reste accessible sans saisie.
  //   (c) durée de conservation côté navigateur : sessionStorage seulement
  //       (purge fermeture onglet) — verbalisé "stockage de session" pour
  //       que l'utilisateur non-tech identifie la nature du stockage.
  //   (d) chaîne CP→coords : transite via /api/geocode (cache Supabase
  //       anonyme, ni compte ni IP côté table geocode_cache, hit_count
  //       agrégé) puis api-adresse.data.gouv.fr en cache miss. Cf. continuité
  //       T-200 r1 documentée dans docs/fixes/geocode-cache-2026-05-06.md.
  // Le renvoi vers la politique de confidentialité globale reste volontairement
  // retiré tant que la page n'existe pas (suivi T-207). À réintroduire en
  // <Link> au go-live, en intégrant le wording cache serveur ci-dessus.
  return (
    <p className="mt-4 text-[11px] leading-normal text-terroir-ink/[0.55]">
      Saisie facultative — la fiche du producteur reste consultable sans. Ta
      position (géoloc ou résolue depuis ton code postal) reste dans ton
      navigateur (stockage de session, effacé à la fermeture de l&apos;onglet)
      pour calculer la distance ; elle n&apos;est jamais associée à ton compte
      ni à ta visite côté serveur. La saisie d&apos;un code postal transite
      via TerrOir (cache anonyme du couple code postal → coordonnées commune)
      vers le service public api-adresse.data.gouv.fr.
    </p>
  );
}

function DistanceResult({
  distance,
  producerName,
  onReset,
  onCollapse,
}: {
  distance: number;
  producerName: string;
  onReset: () => void;
  onCollapse: () => void;
}) {
  const ref = GMS_DISTANCE_KM_REFERENCE;
  // Ratio visuel borné [0,1] : la barre du producteur est proportionnelle à
  // la référence circuit long. Un producteur très lointain s'aligne au max.
  const ratio = Math.max(0.04, Math.min(distance / ref, 1));
  const displayName = formatProducerNameForWidget(producerName);
  return (
    <div id={PANEL_ID} className="rounded-xl border border-terroir-border bg-white p-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700">
              Jusqu&apos;à toi
            </div>
            <div className="md:hidden">
              <CollapseLink onClick={onCollapse} />
            </div>
          </div>
          <div className="mt-1 font-serif text-[44px] leading-none text-green-900 md:text-[52px]">
            {distance} <span className="text-[22px] md:text-[26px]">km</span>
          </div>
          <p className="mt-2 text-[13px] leading-normal text-terroir-ink/[0.7]">
            à vol d&apos;oiseau jusqu&apos;à toi depuis {displayName}.
          </p>
        </div>
        <div className="md:border-l md:border-terroir-border md:pl-5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-muted">
              En circuit long
            </div>
            <div className="hidden md:block">
              <CollapseLink onClick={onCollapse} />
            </div>
          </div>
          <div className="mt-1 font-serif text-[28px] leading-none text-terroir-ink/[0.55] md:text-[32px]">
            ~{ref} km
          </div>
          <p className="mt-2 text-[13px] leading-normal text-terroir-ink/[0.6]">
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

function DistanceOutOfReach({
  producerName,
  onReset,
  onCollapse,
}: {
  producerName: string;
  onReset: () => void;
  onCollapse: () => void;
}) {
  // Variante du DistanceResult quand la distance dépasse
  // DISTANCE_OUT_OF_REACH_KM (T-230) : on garde la mise en page (carte + RGPD
  // + reset) pour que le visiteur sente que sa position a été prise en compte,
  // mais on retire la distance chiffrée et la comparaison ~1500 km. Ton
  // factuel et neutre — pas de rouge ni de wording culpabilisant.
  const displayName = formatProducerNameForWidget(producerName);
  return (
    <div id={PANEL_ID} className="rounded-xl border border-terroir-border bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700">
            Hors zone
          </div>
          <p className="mt-2 text-[14px] leading-[1.55] text-terroir-ink/[0.78]">
            Depuis ta position, {displayName} se trouve en dehors de notre
            zone de circuit court. La comparaison à vol d&apos;oiseau ne
            reflète plus une logique de proximité pertinente.
          </p>
        </div>
        <CollapseLink onClick={onCollapse} />
      </div>

      <button
        type="button"
        onClick={onReset}
        className="mt-4 inline-flex h-9 items-center text-[12px] text-terroir-ink/[0.55] underline-offset-2 hover:text-green-900 hover:underline"
      >
        Changer ma position
      </button>

      <PrivacyNote />
    </div>
  );
}

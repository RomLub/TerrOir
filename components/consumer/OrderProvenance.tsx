"use client";

import { useEffect, useMemo, useState } from "react";
import { MiniMap } from "@/components/ui/mini-map";
import {
  DISTANCE_OUT_OF_REACH_KM,
  haversineKm,
} from "@/lib/geo/haversine";
import {
  GMS_DISTANCE_KM_REFERENCE,
  GMS_DISTANCE_SOURCE_LABEL,
} from "@/lib/producers/gms-distance";

// T-222 — section "D'où vient ma viande" affichée sur la page confirmation
// (/compte/confirmation/[id]) et la page détail commande
// (/compte/commandes/[id]).
//
// Design produit :
//   - Le producteur EST le point de retrait (modèle TerrOir : pas de hub
//     intermédiaire). La distance pédagogique côté T-222 = consumer → ferme,
//     même valeur que celle calculée par DistanceWidget sur la fiche
//     producteur publique. Mise en regard avec ~1500 km circuit long pour
//     démarquer la chaîne courte.
//
// Privacy (alignement T-200 / DistanceWidget) :
//   - La position du consumer est lue depuis sessionStorage (clé partagée
//     `terroir_geo_session`, écrite par DistanceWidget). Aucune position
//     consumer côté serveur — la page commande est rendue SSR sans cette
//     info, le composant client la lit après mount.
//   - Coords producteur déjà arrondies à 2 décimales (~1.1 km) côté SSR via
//     roundCoord(). Pas de re-arrondi nécessaire ici.
//
// État UX :
//   - mounted=false (SSR + 1er render) : carte + libellé producteur seul,
//     pas de comparaison distance (évite mismatch hydratation).
//   - mounted=true sans session : message neutre "Renseigne ta position
//     sur la fiche du producteur pour voir la distance" + carte producteur
//     seul + comparaison ~1500 km générique.
//   - mounted=true avec session valide ET distance ≤ 500 km : km affiché
//     + comparaison ~1500 km.
//   - distance > 500 km : message "hors zone circuit court" (DOM-TOM, T-230)
//     + carte producteur seul.

const SESSION_KEY = "terroir_geo_session";

type GeoSession = { lat: number; lng: number; source: "geoloc" | "postal" };

function readSession(): GeoSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GeoSession>;
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

export type OrderProvenanceProps = {
  producerName: string;
  producerLat: number | null;
  producerLng: number | null;
  className?: string;
};

export function OrderProvenance({
  producerName,
  producerLat,
  producerLng,
  className,
}: OrderProvenanceProps) {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<GeoSession | null>(null);

  useEffect(() => {
    setMounted(true);
    setSession(readSession());
  }, []);

  const distance = useMemo(() => {
    if (!session || producerLat === null || producerLng === null) return null;
    return haversineKm(session.lat, session.lng, producerLat, producerLng);
  }, [session, producerLat, producerLng]);

  // Pas de coords producteur — on n'affiche rien (cas exceptionnel : producer
  // dont le géocodage a échoué, fail-safe T-200).
  if (producerLat === null || producerLng === null) return null;

  const outOfReach =
    distance !== null && distance > DISTANCE_OUT_OF_REACH_KM;
  const showDistance = mounted && distance !== null && !outOfReach;

  return (
    <section
      className={`bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6 md:p-8 ${className ?? ""}`}
      aria-labelledby="provenance-heading"
    >
      <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">
        D&rsquo;où vient ta viande
      </div>
      <h2
        id="provenance-heading"
        className="mt-2 font-serif text-[24px] md:text-[28px] text-green-900 leading-tight"
      >
        Directement de la ferme,{" "}
        <em className="not-italic">
          <span className="italic text-terra-700">sans détour.</span>
        </em>
      </h2>

      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-xl border border-terroir-border h-[200px] md:h-[240px]">
          <MiniMap
            latitude={producerLat}
            longitude={producerLng}
            markerLabel={producerName}
            zoom={9}
          />
        </div>

        <div className="flex flex-col justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terra-700">
              Ta viande
            </div>
            {showDistance ? (
              <>
                <div className="mt-1 font-serif text-[36px] leading-none text-green-900 md:text-[44px]">
                  {distance}{" "}
                  <span className="text-[18px] md:text-[22px]">km</span>
                </div>
                <p className="mt-2 text-[13px] leading-normal text-terroir-ink/[0.7]">
                  à vol d&rsquo;oiseau jusqu&rsquo;à toi depuis {producerName}.
                </p>
              </>
            ) : outOfReach ? (
              <p className="mt-1 text-[14px] leading-[1.55] text-terroir-ink/[0.78]">
                {producerName} se trouve en dehors de la zone de circuit court
                par rapport à ta position. La comparaison de proximité ne
                s&rsquo;applique pas.
              </p>
            ) : (
              <p className="mt-1 text-[14px] leading-[1.55] text-terroir-ink/[0.78]">
                Ta viande a été élevée et préparée à la ferme{" "}
                <strong>{producerName}</strong>. Tu vas la chercher
                directement sur place — pas d&rsquo;entrepôt ni de centrale
                d&rsquo;achat sur le trajet.
              </p>
            )}
          </div>

          {!outOfReach && (
            <div className="border-t border-terroir-border/60 pt-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-muted">
                En circuit long
              </div>
              <div className="mt-1 font-serif text-[22px] leading-none text-terroir-ink/[0.55] md:text-[26px]">
                ~{GMS_DISTANCE_KM_REFERENCE} km
              </div>
              <p className="mt-1.5 text-[12px] leading-normal text-terroir-ink/[0.6]">
                en moyenne en circuit long (importation, centrale
                d&rsquo;achat, entrepôts).
              </p>
              <p className="mt-1 text-[11px] leading-[1.4] text-terroir-ink/[0.45]">
                {GMS_DISTANCE_SOURCE_LABEL}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

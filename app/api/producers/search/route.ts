import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { roundCoord } from "@/lib/producers/coords";

// GET /api/producers/search?lat=&lng=&radius=&especes=bovin,ovin&labels=bio
export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lng = parseFloat(url.searchParams.get("lng") ?? "");
  const radius = parseFloat(url.searchParams.get("radius") ?? "50");

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json(
      { error: "Paramètres lat/lng requis" },
      { status: 400 },
    );
  }
  if (Number.isNaN(radius) || radius <= 0 || radius > 500) {
    return NextResponse.json(
      { error: "radius hors bornes (1-500 km)" },
      { status: 400 },
    );
  }

  const especes = (url.searchParams.get("especes") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const labels = (url.searchParams.get("labels") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("search_producers", {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radius,
    p_especes: especes.length ? especes : null,
    p_labels: labels.length ? labels : null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sécurité (T-200 r2) : la RPC search_producers retourne les coordonnées
  // brutes des producers (colonnes `latitude` / `longitude` — cf. migration
  // 20260421000000_search_producers_product_count.sql, signature returns
  // table). On floute systématiquement avant exposition côté client pour
  // ne pas leaker l'adresse personnelle du producteur. Cohérent avec le
  // comportement de fetchPublicProducerBySlug pour la fiche publique.
  // NB : l'INPUT lat/lng (querystring visiteur) reste en précision native
  // côté serveur — c'est nécessaire pour la recherche par proximité, hors
  // scope T-200.
  type SearchRow = {
    latitude: number | null;
    longitude: number | null;
    [key: string]: unknown;
  };
  const sanitized = ((data ?? []) as SearchRow[]).map((row) => ({
    ...row,
    latitude: roundCoord(row.latitude),
    longitude: roundCoord(row.longitude),
  }));
  return NextResponse.json({ count: sanitized.length, results: sanitized });
}

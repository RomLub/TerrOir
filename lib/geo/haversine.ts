// Distance grand-cercle (à vol d'oiseau) entre deux points lat/lng en km,
// arrondie à 1 décimale. Utilisé par DistanceWidget (fiche producteur publique)
// pour comparer la distance ferme→consommateur à la référence circuit long
// (GMS_DISTANCE_KM_REFERENCE = 1500 km).

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = EARTH_RADIUS_KM * c;
  return Math.round(km * 10) / 10;
}

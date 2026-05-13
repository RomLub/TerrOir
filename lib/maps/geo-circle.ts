// Génère un polygone GeoJSON approximant un cercle géographique
// centré sur `(lat, lng)` de rayon `radiusKm`, en parcourant `steps`
// points équidistants sur l'orthodromie.
//
// Utilisé par CarteClient pour visualiser la zone du filtre de rayon.
// 64 segments donnent un cercle visuellement lisse aux zooms usuels
// (8-14) et reste léger côté GPU.

const EARTH_RADIUS_KM = 6371;

export type CirclePolygon = {
  type: 'Polygon';
  coordinates: [number, number][][];
};

export function buildCirclePolygon(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  steps = 64,
): CirclePolygon {
  const coords: [number, number][] = [];
  const latRad = (centerLat * Math.PI) / 180;
  const lngRad = (centerLng * Math.PI) / 180;
  const angularDistance = radiusKm / EARTH_RADIUS_KM;

  for (let i = 0; i <= steps; i++) {
    const bearing = (i * 2 * Math.PI) / steps;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const lng2 =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(lat2),
      );
    coords.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }

  return {
    type: 'Polygon',
    coordinates: [coords],
  };
}

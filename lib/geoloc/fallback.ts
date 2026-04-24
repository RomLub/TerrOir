// Fallback geolocation center used when user geolocation fails or is denied.
// Currently Le Mans (Sarthe), the current coverage area — update here if that changes.
export const GEOLOC_FALLBACK = {
  lat: 48.0061,
  lng: 0.1996,
  label: 'Le Mans',
} as const;

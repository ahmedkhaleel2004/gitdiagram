// The early-access places for making new videos: anyone, on any device, in
// California, Washington, New York, Ontario, British Columbia, or within
// 60 km of London or Paris (Paris also matches all of Île-de-France).
//
// Pure data and geometry, so the server's rule and the operator dashboard's
// "Priority places" count can share one definition. The server reads
// Vercel's IP geolocation headers; the dashboard reads the presence worker's
// (Cloudflare's) geolocation. Both are country, ISO 3166-2 region code, city
// and coordinates.

const PRIORITY_REGIONS: Readonly<Record<string, readonly string[]>> = {
  US: ["CA", "WA", "NY"],
  CA: ["ON", "BC"],
  FR: ["IDF"], // Île-de-France: Paris and the area around it
};

// "Anywhere around" these cities: within `km` of the center, or by city name
// when there are no coordinates.
const PRIORITY_METROS: ReadonlyArray<{
  country: string;
  lat: number;
  lon: number;
  km: number;
  city: RegExp;
}> = [
  { country: "GB", lat: 51.5072, lon: -0.1276, km: 60, city: /london/i },
  { country: "FR", lat: 48.8566, lon: 2.3522, km: 60, city: /paris/i },
];

/** Great-circle distance in kilometres. */
function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

interface Place {
  country: string;
  region: string;
  city: string;
  lat: number | null;
  lon: number | null;
}

/** Whether a geolocated place is one of the early-access places. */
export function isPriorityPlace(place: Place): boolean {
  if (PRIORITY_REGIONS[place.country]?.includes(place.region)) return true;
  const metro = PRIORITY_METROS.find((each) => each.country === place.country);
  if (!metro) return false;
  const { lat, lon } = place;
  if (
    lat !== null &&
    lon !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  )
    return distanceKm({ lat, lon }, metro) <= metro.km;
  return metro.city.test(place.city);
}

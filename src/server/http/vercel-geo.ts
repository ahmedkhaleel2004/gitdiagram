import "server-only";

/** Where Vercel's edge placed the caller. Off Vercel every field is empty. */
export interface RequestGeo {
  country: string;
  region: string;
  city: string;
  lat: number | null;
  lon: number | null;
}

export function requestGeo(request: Request): RequestGeo {
  const headers = request.headers;
  const lat = Number.parseFloat(headers.get("x-vercel-ip-latitude") ?? "");
  const lon = Number.parseFloat(headers.get("x-vercel-ip-longitude") ?? "");
  return {
    country: headers.get("x-vercel-ip-country") ?? "",
    region: headers.get("x-vercel-ip-country-region") ?? "",
    city: safeDecode(headers.get("x-vercel-ip-city") ?? ""),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

/** Vercel percent-encodes the city; off Vercel the header may be anything. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

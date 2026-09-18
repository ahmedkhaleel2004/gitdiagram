export const dynamic = "force-dynamic";

export function GET(request: Request) {
  // Vercel supplies these coarse IP-derived codes. Never return the raw IP.
  const country = request.headers.get("x-vercel-ip-country") ?? "";
  const region = request.headers.get("x-vercel-ip-country-region") ?? "";

  return Response.json(
    {
      country: /^[A-Z]{2}$/.test(country) ? country : "",
      region: /^[A-Z0-9]{1,3}$/.test(region) ? region : "",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

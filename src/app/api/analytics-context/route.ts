import { analyticsContext } from "~/lib/cloudflare-edge";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  // Vercel supplies these coarse IP-derived codes. Never return the raw IP.
  return Response.json(analyticsContext(request.headers), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

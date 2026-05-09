import { getCachedBrowsePage } from "~/app/browse/data";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const result = await getCachedBrowsePage({
    q: searchParams.get("q"),
    sort: searchParams.get("sort"),
    minStars: searchParams.get("minStars"),
    page: searchParams.get("page"),
  });

  if (!result) {
    return Response.json(
      { error: "Browse index unavailable." },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return Response.json(result, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "CDN-Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Vercel-CDN-Cache-Control":
        "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

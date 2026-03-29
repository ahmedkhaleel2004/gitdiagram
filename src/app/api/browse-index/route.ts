import { getCachedBrowseIndex } from "~/app/browse/data";

export async function GET() {
  const entries = await getCachedBrowseIndex();

  if (!entries) {
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

  return Response.json(entries, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

import { SPONSOR_ANSWER_HEADERS, sponsorAnswer } from "~/lib/sponsor-campaign";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(
    sponsorAnswer(
      new URL(request.url).hostname,
      Date.now(),
      process.env.SPONSOR_PREVIEW_CAMPAIGN,
    ),
    { headers: SPONSOR_ANSWER_HEADERS },
  );
}
